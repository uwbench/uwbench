import type { RunRequest, UnderwritingSubmission } from "@uwbench/protocol";
import {
  casePackagePayload,
  inferDocumentType,
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
import {
  isUsableSpread,
  mapChatPathToSubmission,
  needsProductOcr,
  spreadFromIdpExtraction,
  spreadFromUnknown,
} from "./submission-map.js";
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
    putDocumentText: resolveToolName(catalog, "putDocumentText"),
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
      ...(gatewayFiles.length === 0 || request.benchmark === "loab"
        ? { casePackage: casePackagePayload(request, pkg) }
        : {}),
    },
  });
  const workspaceId = extractWorkspaceId(created, workspaceName);
  let uploaded = false;
  let finalized = false;
  const documentIds: string[] = [];

  if (files.length > 0) {
    // Live submit_documents reserves one S3 object. Reusing that URL for every
    // case file overwrites the statement scan with later letter/AR text, and
    // Textract then fails (UnsupportedDocumentException).
    for (const file of files) {
      const submitResult = await mcp.callTool(
        toolNames.submitDocuments,
        submitDocumentsArguments(workspaceId, [file]),
      );
      const uploads = interpretSubmitDocumentsResult(submitResult);
      const target = matchUpload(uploads, file, 0);
      if (target) {
        await uploadBytes(target, file, fetchImpl);
        uploaded = true;
        const uploadedId = mcpDocumentId(target.documentId);
        if (uploadedId) documentIds.push(uploadedId);
        if (uploadedId && file.text.trim()) {
          await landDocumentText(
            mcp,
            catalog,
            toolNames.putDocumentText,
            workspaceId,
            uploadedId,
            file,
            sleep,
          );
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
        continue;
      }
      const readyId = mcpDocumentId(
        firstString(asRecord(submitResult), "documentId", "id"),
      );
      if (readyId) {
        documentIds.push(readyId);
        if (file.text.trim()) {
          await landDocumentText(
            mcp,
            catalog,
            toolNames.putDocumentText,
            workspaceId,
            readyId,
            file,
            sleep,
          );
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
  // Prefer the statement scan (PNG/PDF financials) over letter/workbook so
  // Textract/IDP runs on the page that actually has the P&L.
  const primaryDocumentId = primaryUploadedDocumentId(files, documentIds);
  const extractIds =
    request.benchmark === "loab"
      ? loabExtractDocumentIds(files, documentIds)
      : primaryDocumentId
        ? [primaryDocumentId]
        : [];
  const waitForIdp =
    request.benchmark === "loab" ? false : needsProductOcr(pkg);
  let intelligence: unknown;
  let extraction: unknown;
  let spread: unknown;
  for (const documentId of extractIds) {
    try {
      intelligence = await mcp.callTool(toolNames.documentIntelligence, {
        workspaceId,
        documentId,
      });
    } catch {
      intelligence = undefined;
    }
    throwIfAborted(signal);
    extraction = await readOrPollExtraction(
      mcp,
      toolNames.dataExtraction,
      workspaceId,
      documentId,
      waitForIdp,
      config.pollIntervalMs,
      config.pollTimeoutMs,
      sleep,
      signal,
      request.benchmark !== "loab",
    );
    throwIfAborted(signal);
  }
  if (
    primaryDocumentId &&
    (catalog.length === 0 || catalog.includes(toolNames.financialSpread))
  ) {
    try {
      spread = await mcp.callTool(toolNames.financialSpread, {
        workspaceId,
        documentId: primaryDocumentId,
      });
    } catch {
      spread = undefined;
    }
  }

  throwIfAborted(signal);
  let memo: unknown;
  try {
    const memoJob = await mcp.callTool(toolNames.professionalMemo, {
      workspaceId,
      sourceType: "workspace",
      sourceId: workspaceId,
      templateId: "default-credit-memo-template",
    });
    const jobId =
      firstString(asRecord(memoJob), "jobId", "id", "memoJobId") ??
      firstString(asRecord(asRecord(memoJob)?.["job"]), "id", "jobId");
    memo = await pollMemo(
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
  } catch {
    memo = undefined;
  }

  const submission = mapChatPathToSubmission(pkg, {
    workspaceId,
    workspaceName,
    extraction,
    intelligence,
    spread,
    memo,
  });
  if (request.benchmark === "loab") {
    const proposed = proposedDecisionToken(memo);
    if (proposed) {
      submission.memo.markdown = appendLoabProposedDecisionMarker(
        submission.memo.markdown,
        proposed,
      );
    }
  }

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
  files: (Pick<CaseDocument, "documentId" | "mimeType" | "bytes"> &
    Partial<
      Pick<CaseDocument, "fileName" | "documentType" | "sourceId" | "title">
    >)[],
): Record<string, unknown> {
  const primary = files[0];
  const filename =
    primary?.fileName ?? `${primary?.documentId ?? "document"}.txt`;
  const contentType = primary?.mimeType ?? "text/plain";
  return {
    workspaceId,
    documentType:
      primary?.documentType ??
      inferDocumentType({
        ...(primary?.documentId ? { documentId: primary.documentId } : {}),
        ...(primary?.sourceId ? { sourceId: primary.sourceId } : {}),
        ...(primary?.title ? { title: primary.title } : {}),
        fileName: filename,
        mimeType: contentType,
      }),
    filename,
    contentType,
    documents: files.map((file) => ({
      fileName: file.fileName ?? `${file.documentId}.txt`,
      contentType: file.mimeType,
      sizeBytes: file.bytes.length,
      documentId: file.documentId,
      documentType:
        file.documentType ??
        inferDocumentType({
          documentId: file.documentId,
          ...(file.sourceId ? { sourceId: file.sourceId } : {}),
          ...(file.title ? { title: file.title } : {}),
          ...(file.fileName ? { fileName: file.fileName } : {}),
          mimeType: file.mimeType,
        }),
    })),
  };
}

export function putDocumentTextArguments(
  workspaceId: string,
  documentId: string,
  file: Pick<CaseDocument, "text">,
): Record<string, unknown> {
  const markdown = file.text.trim();
  return {
    workspaceId,
    documentId,
    pages: [{ pageNumber: 1, markdown }],
    pdfType: "TextBased",
    confidence: 0.95,
    encodingIssues: false,
    garbled: false,
    pagesNeedingOcr: [],
    source: "uwbench-case-text",
  };
}

/** Live `run_data_extraction` requires documentId: string. Omit the call if missing. */
export function dataExtractionArguments(
  workspaceId: string,
  documentId: unknown,
  confirm = false,
  includeLendingBlueprint = true,
): Record<string, unknown> | undefined {
  const id = mcpDocumentId(documentId);
  if (!id) return undefined;
  return {
    workspaceId,
    documentId: id,
    ...(includeLendingBlueprint
      ? { blueprintType: LENDING_BLUEPRINT_TYPE }
      : {}),
    ...(confirm ? { confirm: true } : {}),
  };
}

export function primaryUploadedDocumentId(
  files: Pick<CaseDocument, "sourceId" | "title" | "mimeType" | "fileName">[],
  documentIds: string[],
): string | undefined {
  if (documentIds.length === 0) return undefined;
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [index, file] of files.entries()) {
    if (!documentIds[index]) continue;
    const score = uploadExtractPriority(file);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return mcpDocumentId(documentIds[bestIndex] ?? documentIds[0]);
}

function uploadExtractPriority(
  file: Pick<CaseDocument, "sourceId" | "title" | "mimeType" | "fileName">,
): number {
  const blob = `${file.sourceId} ${file.title} ${file.mimeType} ${file.fileName ?? ""}`;
  let score = 0;
  if (/financial|statement/i.test(blob)) score += 5;
  if (/image\/(png|jpeg|jpg|tiff)/i.test(file.mimeType)) score += 4;
  if (file.mimeType === "application/pdf") score += 2;
  if (/workbook|spreadsheet/i.test(blob)) score -= 1;
  if (/letter|tax|aging|reconcil/i.test(blob)) score -= 6;
  return score;
}

async function readOrPollExtraction(
  mcp: McpClient,
  toolName: string,
  workspaceId: string,
  documentId: string,
  waitForIdp: boolean,
  intervalMs: number,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
  includeLendingBlueprint = true,
): Promise<unknown> {
  const call = async (confirm: boolean): Promise<unknown> => {
    const args = dataExtractionArguments(
      workspaceId,
      documentId,
      confirm,
      includeLendingBlueprint,
    );
    if (!args) return undefined;
    return mcp.callTool(toolName, args);
  };
  let last: unknown;
  try {
    last = await call(false);
  } catch {
    last = undefined;
  }
  last = await confirmExtractionIfQuoted(last, call);
  if (!waitForIdp || isExtractionReady(last) || isExtractionFailed(last)) {
    return last;
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    throwIfAborted(signal);
    await sleep(intervalMs);
    throwIfAborted(signal);
    try {
      last = await call(false);
    } catch {
      last = undefined;
    }
    last = await confirmExtractionIfQuoted(last, call);
    if (isExtractionReady(last) || isExtractionFailed(last)) return last;
  }
  return last;
}

async function confirmExtractionIfQuoted(
  result: unknown,
  call: (confirm: boolean) => Promise<unknown>,
): Promise<unknown> {
  if (!extractionNeedsConfirm(result)) return result;
  try {
    return await call(true);
  } catch {
    return result;
  }
}

export function isExtractionReady(value: unknown): boolean {
  if (typeof value === "string") {
    if (/no IDP extraction result yet|still be processing/i.test(value)) {
      return false;
    }
    return /structured financial facts found/i.test(value);
  }
  const record = asRecord(value);
  if (!record) return false;
  // Live run_data_extraction sets ready:false when `facts` is empty even
  // though extractedData already has incomeStatement period maps.
  if (
    isUsableSpread(spreadFromUnknown(record) ?? spreadFromIdpExtraction(record))
  ) {
    return true;
  }
  if (record["ready"] === true) return true;
  if (record["ready"] === false) return false;
  const text = firstString(record, "message", "text") ?? "";
  if (/no IDP extraction result yet|still be processing/i.test(text)) {
    return false;
  }
  return /structured financial facts found/i.test(text);
}

export function isExtractionFailed(value: unknown): boolean {
  if (typeof value === "string") {
    return /document text extraction failed|unsupporteddocument/i.test(value);
  }
  const record = asRecord(value);
  if (!record) return false;
  const status = firstString(record, "status")?.toUpperCase();
  if (status === "FAILED" || status === "ERROR") return true;
  const text = firstString(record, "message", "text") ?? "";
  return /document text extraction failed|unsupporteddocument/i.test(text);
}

function extractionNeedsConfirm(value: unknown): boolean {
  if (typeof value === "string") {
    return /price quote|confirm and authorize/i.test(value);
  }
  const record = asRecord(value);
  if (!record) return false;
  if (record["paymentRequired"] !== undefined) return true;
  const text = firstString(record, "message", "text") ?? "";
  return /price quote|confirm and authorize/i.test(text);
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

async function landDocumentText(
  mcp: McpClient,
  catalog: readonly string[],
  toolName: string,
  workspaceId: string,
  documentId: string,
  file: Pick<CaseDocument, "text">,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  if (catalog.length > 0 && !catalog.includes(toolName)) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const landed = await mcp.callTool(
        toolName,
        putDocumentTextArguments(workspaceId, documentId, file),
      );
      const status = firstString(asRecord(landed), "status")?.toUpperCase();
      if (status !== "PENDING_UPLOAD") return;
    } catch {
      // Text-layer ingest is best-effort. Extraction still runs.
    }
    await sleep(400);
  }
}

function uniqueDocumentIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

const LOAB_EXTRACT_TYPES = new Set([
  "loan-application",
  "payslip",
  "bank-statement",
  "identity",
  "credit-report",
  "property-valuation",
  "income-verification",
  "privacy-consent",
  "purchase-contract",
  "company-registration",
]);

export function loabExtractDocumentIds(
  files: Pick<
    CaseDocument,
    | "documentType"
    | "sourceId"
    | "title"
    | "fileName"
    | "documentId"
    | "mimeType"
  >[],
  documentIds: string[],
): string[] {
  const ids: string[] = [];
  for (const [index, file] of files.entries()) {
    const id = mcpDocumentId(documentIds[index]);
    if (!id) continue;
    const type =
      file.documentType ??
      inferDocumentType({
        documentId: file.documentId,
        sourceId: file.sourceId,
        title: file.title,
        ...(file.fileName ? { fileName: file.fileName } : {}),
        mimeType: file.mimeType,
      });
    if (LOAB_EXTRACT_TYPES.has(type)) ids.push(id);
  }
  return uniqueDocumentIds(ids);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOAB_PROPOSED_DECISION_MARKER = "securelend-proposed-decision";

function proposedDecisionToken(memo: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (node: unknown): string | undefined => {
    if (node === undefined || node === null || seen.has(node)) return undefined;
    if (typeof node !== "object") return undefined;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    const record = node as Record<string, unknown>;
    const direct = firstString(record, "proposedDecision", "proposed_decision");
    if (direct) return direct;
    const nested = firstString(
      asRecord(record["proposedDecision"]) ??
        asRecord(record["proposed_decision"]),
      "decision",
      "value",
    );
    if (nested) return nested;
    for (const value of Object.values(record)) {
      const found = visit(value);
      if (found) return found;
    }
    return undefined;
  };
  return visit(memo);
}

function appendLoabProposedDecisionMarker(
  markdown: string,
  decision: string,
): string {
  const token = decision.trim().toUpperCase().replaceAll(" ", "_");
  const marker = `<!-- ${LOAB_PROPOSED_DECISION_MARKER}: ${token} -->`;
  if (markdown.includes(marker)) return markdown;
  return `${markdown.trimEnd()}\n\n${marker}\n`;
}
