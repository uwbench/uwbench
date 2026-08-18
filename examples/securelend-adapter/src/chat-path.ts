import type { RunRequest, UnderwritingSubmission } from "@uwbench/protocol";
import {
  loadCasePackage,
  type CaseDocument,
  type CasePackage,
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
): Promise<ChatPathRunResult> {
  throwIfAborted(signal);
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? defaultSleep;
  const pkg = await loadCasePackage(request, fetchImpl);
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

  const files = pkg.documents.filter((document) => document.uploadable);
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
      ...(files.length === 0
        ? { casePackage: casePackagePayload(request, pkg) }
        : {}),
    },
  });
  const workspaceId = extractWorkspaceId(created, workspaceName);
  let uploaded = false;
  let finalized = false;
  const documentIds: string[] = [];

  if (files.length > 0) {
    const submitResult = await mcp.callTool(toolNames.submitDocuments, {
      workspaceId,
      documentType: "financial-statement",
      documents: files.map((file) => ({
        fileName: file.fileName ?? `${file.documentId}.txt`,
        contentType: file.mimeType,
        sizeBytes: file.bytes.length,
        documentId: file.documentId,
      })),
    });
    const uploads = interpretSubmitDocumentsResult(submitResult);
    if (uploads.length > 0) {
      for (const [index, file] of files.entries()) {
        const target = matchUpload(uploads, file, index);
        if (!target) continue;
        await uploadBytes(target, file, fetchImpl);
        uploaded = true;
        const uploadedId = mcpDocumentId(target.documentId);
        if (uploadedId) documentIds.push(uploadedId);
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
      }
    } else {
      const readyId = mcpDocumentId(
        firstString(asRecord(submitResult), "documentId", "id"),
      );
      if (readyId) documentIds.push(readyId);
    }
  }

  throwIfAborted(signal);
  // Live MCP schemas require documentId: string on extraction / intelligence.
  // UWBench case ids are not SecureLend document ids — only submit_documents
  // return values count. reasoning_only / already-extracted packs often have
  // empty list_documents; skip those tools rather than send undefined.
  const primaryDocumentId = mcpDocumentId(documentIds[0]);
  let intelligence: unknown;
  let extraction: unknown;
  let spread: unknown;
  if (primaryDocumentId) {
    intelligence = await mcp.callTool(toolNames.documentIntelligence, {
      workspaceId,
      documentId: primaryDocumentId,
    });
    throwIfAborted(signal);
    const extractionArgs = dataExtractionArguments(
      workspaceId,
      primaryDocumentId,
    );
    if (extractionArgs) {
      extraction = await mcp.callTool(toolNames.dataExtraction, extractionArgs);
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

function casePackagePayload(
  request: RunRequest,
  pkg: CasePackage,
): Record<string, unknown> {
  return {
    caseId: request.caseId,
    objective: request.objective,
    lane: request.lane,
    documents: pkg.documents.map((document: CaseDocument) => ({
      documentId: document.documentId,
      sourceId: document.sourceId,
      title: document.title,
      mimeType: document.mimeType,
      text: document.text,
    })),
    records: pkg.records.map((record) => ({
      recordId: record.recordId,
      sourceId: record.sourceId,
      record: record.record,
    })),
  };
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
