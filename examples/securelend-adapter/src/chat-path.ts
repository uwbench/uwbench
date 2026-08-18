import type { RunRequest, UnderwritingSubmission } from "@uwbench/protocol";
import {
  casePackagePayload,
  loadCasePackage,
  synthesizeFinancialPackage,
  type CaseDocument,
} from "./case-package.js";
import {
  asRecord,
  firstString,
  McpClient,
  type McpClientOptions,
} from "./mcp-client.js";
import {
  assertEphemeralWorkspaceName,
  resolveToolName,
  workspaceNameForRun,
  type ChatPathTool,
} from "./mcp-tools.js";
import { mapChatPathToSubmission } from "./submission-map.js";
import {
  finalizeUploadedDocument,
  interpretSubmitDocumentsResult,
  matchUpload,
  uploadBytes,
} from "./upload.js";

export interface ChatPathConfig {
  mcpUrl: string;
  token: string;
  documentApiUrl?: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ChatPathRunResult {
  submission: UnderwritingSubmission;
  workspaceId: string;
  workspaceName: string;
  toolNames: Record<ChatPathTool, string>;
  uploaded: boolean;
  finalized: boolean;
}

const LENDING_BLUEPRINT_TYPE = "financial_statement";

export async function runProductChatPath(
  request: RunRequest,
  config: ChatPathConfig,
  signal?: AbortSignal,
  discoveryHint?: unknown,
): Promise<ChatPathRunResult> {
  throwIfAborted(signal);
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? defaultSleep;
  const pkg = await loadCasePackage(request, fetchImpl, discoveryHint);
  throwIfAborted(signal);

  const clientOptions: McpClientOptions = {
    url: config.mcpUrl,
    token: config.token,
    fetchImpl,
  };
  const mcp = new McpClient(clientOptions);
  await mcp.initialize();
  let catalog: string[] = [];
  try {
    catalog = await mcp.listToolNames();
  } catch {
    catalog = [];
  }
  const toolNames = {
    createWorkspace: resolveToolName(catalog, "createWorkspace"),
    submitDocuments: resolveToolName(catalog, "submitDocuments"),
    documentIntelligence: resolveToolName(catalog, "documentIntelligence"),
    dataExtraction: resolveToolName(catalog, "dataExtraction"),
    financialSpread: resolveToolName(catalog, "financialSpread"),
    professionalMemo: resolveToolName(catalog, "professionalMemo"),
    memoStatus: resolveToolName(catalog, "memoStatus"),
  } satisfies Record<ChatPathTool, string>;

  const gatewayFiles = pkg.documents.filter((document) => document.uploadable);
  const synthesized =
    gatewayFiles.length === 0 ? synthesizeFinancialPackage(pkg) : undefined;
  const files = synthesized ? [synthesized] : gatewayFiles;
  const workspaceName = workspaceNameForRun(request.caseId, now());
  assertEphemeralWorkspaceName(workspaceName);
  const created = await mcp.callTool(toolNames.createWorkspace, {
    name: workspaceName,
    clientName: workspaceName,
    metadata: {
      source: "uwbench",
      caseId: request.caseId,
      benchmark: request.benchmark,
      lane: request.lane,
      ...(gatewayFiles.length === 0
        ? { casePackage: casePackagePayload(request, pkg) }
        : {}),
    },
  });
  const workspaceId = extractWorkspaceId(created, workspaceName);
  let uploaded = false;
  let finalized = false;
  const documentIds: string[] = [];

  const uploadedDocs: UploadedCaseDocument[] = [];
  if (files.length > 0) {
    // Live submit_documents reserves one S3 object. One call per file so a
    // later letter / workbook / AR-aging body cannot overwrite the scan.
    for (const file of files) {
      const submitResult = await mcp.callTool(
        toolNames.submitDocuments,
        submitDocumentsArguments(workspaceId, [file]),
      );
      const uploads = interpretSubmitDocumentsResult(submitResult);
      if (uploads.length > 0) {
        const target = matchUpload(uploads, file, 0);
        if (!target) continue;
        await uploadBytes(target, file, fetchImpl);
        uploaded = true;
        const uploadedId = mcpDocumentId(target.documentId);
        if (uploadedId) {
          documentIds.push(uploadedId);
          uploadedDocs.push({ file, documentId: uploadedId });
        }
        if (config.documentApiUrl) {
          await finalizeUploadedDocument(
            config.documentApiUrl,
            {
              documentId: uploadedId ?? file.documentId,
              workspaceId,
              fileName: file.fileName ?? file.documentId,
              contentType: file.mimeType,
              ...(target.uploadFields?.["key"]
                ? { key: target.uploadFields["key"] }
                : {}),
            },
            config.token,
            fetchImpl,
          );
          finalized = true;
        }
      } else {
        const readyId = mcpDocumentId(
          firstString(asRecord(submitResult), "documentId", "id"),
        );
        if (readyId) {
          documentIds.push(readyId);
          uploadedDocs.push({ file, documentId: readyId });
        }
      }
    }
  }

  throwIfAborted(signal);
  // Live MCP schemas require documentId: string on extraction / intelligence.
  // UWBench case ids are not SecureLend document ids — only submit_documents
  // return values count. reasoning_only packs often have empty list_documents;
  // synthesize a package from already-loaded public records and upload it so
  // extract/spread can run. Never send undefined documentId.
  const primaryDocumentId = primaryUploadedDocumentId(
    uploadedDocs,
    documentIds,
  );
  let intelligence: unknown;
  let extraction: unknown;
  let spread: unknown;
  if (primaryDocumentId) {
    try {
      intelligence = await mcp.callTool(toolNames.documentIntelligence, {
        workspaceId,
        documentId: primaryDocumentId,
      });
    } catch {
      intelligence = undefined;
    }
    throwIfAborted(signal);
    const extractionArgs = dataExtractionArguments(
      workspaceId,
      primaryDocumentId,
    );
    if (extractionArgs) {
      try {
        extraction = await readOrPollExtraction({
          mcp,
          toolName: toolNames.dataExtraction,
          extractionArgs,
          intervalMs: config.pollIntervalMs,
          timeoutMs: config.pollTimeoutMs,
          sleep,
          signal,
        });
      } catch {
        extraction = undefined;
      }
    }
    throwIfAborted(signal);
    if (catalog.length === 0 || catalog.includes(toolNames.financialSpread)) {
      try {
        spread = await mcp.callTool(toolNames.financialSpread, {
          workspaceId,
          documentId: primaryDocumentId,
        });
      } catch {
        spread = undefined;
      }
    }
  }

  throwIfAborted(signal);
  const memoJob = await mcp.callTool(toolNames.professionalMemo, {
    workspaceId,
    sourceType: "workspace",
    sourceId: workspaceId,
    templateId: "default-credit-memo-template",
  });
  const jobId =
    firstString(asRecord(memoJob), "jobId", "id", "memoJobId") ??
    firstString(asRecord(asRecord(memoJob)?.["job"]), "id", "jobId");
  const memo = await pollMemo(
    mcp,
    toolNames.memoStatus,
    jobId,
    workspaceId,
    memoJob,
    config.pollIntervalMs,
    config.pollTimeoutMs,
    sleep,
    signal,
  );

  const submission = mapChatPathToSubmission(pkg, {
    workspaceId,
    workspaceName,
    extraction,
    intelligence,
    spread,
    memo,
    lane: request.lane,
  });

  await pkg.client.tryCall("submission.save_artifact", {
    artifactId: `${request.caseId}-securelend-memo`,
    content: submission.memo.markdown,
    contentType: "text/markdown",
  });

  return {
    submission,
    workspaceId,
    workspaceName,
    toolNames,
    uploaded,
    finalized,
  };
}

export function mcpDocumentId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Live `submit_documents` validates top-level filename + contentType. */
export function submitDocumentsArguments(
  workspaceId: string,
  files: Pick<CaseDocument, "documentId" | "fileName" | "mimeType" | "bytes">[],
): Record<string, unknown> {
  const primary = files[0];
  const filename =
    primary?.fileName ?? `${primary?.documentId ?? "document"}.txt`;
  const contentType = primary?.mimeType ?? "text/plain";
  return {
    workspaceId,
    documentType: "financial-statement",
    filename,
    contentType,
    documents: files.map((file) => ({
      fileName: file.fileName ?? `${file.documentId}.txt`,
      contentType: file.mimeType,
      sizeBytes: file.bytes.length,
      documentId: file.documentId,
    })),
  };
}

/** Live `run_data_extraction` requires documentId: string. Omit the call if missing. */
export function dataExtractionArguments(
  workspaceId: string,
  documentId: unknown,
): Record<string, unknown> | undefined {
  const id = mcpDocumentId(documentId);
  if (!id) return undefined;
  return {
    workspaceId,
    documentId: id,
    blueprintType: LENDING_BLUEPRINT_TYPE,
  };
}

export interface UploadedCaseDocument {
  file: CaseDocument;
  documentId: string;
}

/**
 * Keep extraction on the financials PNG / statement, not AR, letter, or workbook.
 */
export function primaryUploadedDocumentId(
  uploaded: UploadedCaseDocument[],
  fallbackIds: string[],
): string | undefined {
  const ranked = [...uploaded]
    .map((item) => ({ item, score: financialUploadScore(item.file) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked[0]) return ranked[0].item.documentId;
  return mcpDocumentId(fallbackIds[0]);
}

function financialUploadScore(file: CaseDocument): number {
  const blob = [
    file.sourceId,
    file.documentId,
    file.fileName ?? "",
    file.title,
    file.mimeType,
  ].join(" ");
  if (
    /ar[-_ ]?aging|accounts receivable|src_ar_|src_doc_letter|src_doc_workbook/i.test(
      blob,
    )
  ) {
    return 0;
  }
  if (
    /letter|workbook|working[-_ ]capital|\.xlsx|\.docx/i.test(blob) &&
    !/financial/i.test(blob)
  ) {
    return 0;
  }
  let score = 1;
  if (/src_doc_financials/i.test(file.sourceId)) score += 100;
  if (/financials/i.test(blob)) score += 50;
  if (file.mimeType === "image/png") score += 20;
  if (file.mimeType === "application/pdf") score += 10;
  return score;
}

/**
 * Product `run_data_extraction` often returns `ready: false` / "no normalized
 * financial facts" while `extractedData` already has period maps. Treat that
 * as ready. Do not stop on `ready === false` alone.
 */
export function isExtractionReady(result: unknown): boolean {
  const record = asRecord(result);
  if (!record) return false;
  if (hasExtractedFinancialData(record)) return true;
  const facts = record["facts"] ?? record["normalizedFacts"];
  if (Array.isArray(facts) && facts.length > 0) return true;
  if (record["ready"] === true) return true;
  const status = firstString(record, "status")?.toUpperCase();
  if (status === "READY" || status === "COMPLETED" || status === "COMPLETE") {
    return true;
  }
  return false;
}

function hasExtractedFinancialData(record: Record<string, unknown>): boolean {
  const extracted =
    asRecord(record["extractedData"]) ??
    asRecord(asRecord(record["result"])?.["extractedData"]) ??
    asRecord(asRecord(record["structuredContent"])?.["extractedData"]);
  if (!extracted) return false;
  return Object.keys(extracted).length > 0;
}

export async function readOrPollExtraction(args: {
  mcp: Pick<McpClient, "callTool">;
  toolName: string;
  extractionArgs: Record<string, unknown>;
  intervalMs: number;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<unknown> {
  let last = await args.mcp.callTool(args.toolName, args.extractionArgs);
  if (isExtractionReady(last)) return last;
  const started = Date.now();
  while (Date.now() - started < args.timeoutMs) {
    throwIfAborted(args.signal);
    await args.sleep(args.intervalMs);
    throwIfAborted(args.signal);
    last = await args.mcp.callTool(args.toolName, args.extractionArgs);
    if (isExtractionReady(last)) return last;
  }
  return last;
}

function extractWorkspaceId(result: unknown, fallbackName: string): string {
  const record = asRecord(result);
  const id =
    firstString(record, "workspaceId", "id") ??
    firstString(asRecord(record?.["workspace"]), "workspaceId", "id");
  if (id) return id;
  return fallbackName;
}

async function pollMemo(
  mcp: McpClient,
  toolName: string,
  jobId: string | undefined,
  workspaceId: string,
  initial: unknown,
  intervalMs: number,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (isMemoComplete(initial)) return initial;
  const started = Date.now();
  let last: unknown = initial;
  while (Date.now() - started < timeoutMs) {
    throwIfAborted(signal);
    await sleep(intervalMs);
    throwIfAborted(signal);
    last = await mcp.callTool(toolName, {
      ...(jobId ? { jobId } : {}),
      workspaceId,
    });
    if (isMemoComplete(last)) return last;
    if (isMemoFailed(last)) {
      throw new Error(
        firstString(asRecord(last), "message", "error") ??
          "SecureLend memo generation failed",
      );
    }
  }
  throw new Error("Timed out waiting for SecureLend get_memo_status");
}

function isMemoComplete(value: unknown): boolean {
  const record = asRecord(value);
  const status = firstString(record, "status")?.toUpperCase();
  if (status === "COMPLETED" || status === "COMPLETE" || status === "DONE") {
    return true;
  }
  const sections = record?.["sections"];
  return Array.isArray(sections) && sections.length > 0 && status !== "PENDING";
}

function isMemoFailed(value: unknown): boolean {
  const status = firstString(asRecord(value), "status")?.toUpperCase();
  return status === "FAILED" || status === "ERROR";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
