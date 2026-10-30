import {
  Iso4217CurrencySchema,
  type RunRequest,
  type UnderwritingSubmission,
} from "@uwbench/protocol";
import {
  isCitableSourceId,
  loadCasePackage,
  type CaseDocument,
  type CasePackage,
  type CasePolicyRule,
  type CaseRecord,
} from "./case-package.js";
import type { SubmissionMappingMode } from "./identity.js";
import { asRecord } from "./mcp-client.js";
import {
  mapPlatformPassthrough,
  type PlatformPassthroughMetadata,
} from "./platform-passthrough.js";
import { mapChatPathToSubmission } from "./submission-map.js";

export interface PlatformPathConfig {
  baseUrl: string;
  actor: string;
  /** Defaults to passthrough. `shaped` restores case-package overrides. */
  mappingMode?: SubmissionMappingMode;
  fetchImpl?: typeof fetch;
}

export type AdapterMappingMetadata =
  PlatformPassthroughMetadata | { adapterMode: "shaped" };

export interface PlatformPathRunResult {
  submission: UnderwritingSubmission;
  workspaceId: string;
  workspaceName: string;
  decision: string;
  metadata: AdapterMappingMetadata;
}

const DECISIONS = new Set([
  "APPROVE_WITH_CONDITIONS",
  "INSUFFICIENT_INFORMATION",
  "DECLINE",
  "REFER",
  "APPROVE",
]);

const SPREAD_FIELDS: Record<string, string> = {
  revenue: "revenue",
  ebitda: "ebitda",
  interestExpense: "interest_expense",
  interest_expense: "interest_expense",
  debtService: "debt_service",
  debt_service: "debt_service",
  totalDebt: "total_debt",
  total_debt: "total_debt",
  longTermDebt: "long_term_debt",
  long_term_debt: "long_term_debt",
  shortTermDebt: "short_term_debt",
  short_term_debt: "short_term_debt",
  currentAssets: "current_assets",
  current_assets: "current_assets",
  currentLiabilities: "current_liabilities",
  current_liabilities: "current_liabilities",
  totalAssets: "total_assets",
  total_assets: "total_assets",
  totalLiabilities: "total_liabilities",
  total_liabilities: "total_liabilities",
  equity: "equity",
  cash: "cash",
  forcedLiquidationValue: "forced_liquidation_value",
  forced_liquidation_value: "forced_liquidation_value",
  requestedAmount: "requested_amount",
  requested_amount: "requested_amount",
  loanAmount: "loan_amount",
  loan_amount: "loan_amount",
  topCustomerRevenue: "top_customer_revenue",
  top_customer_revenue: "top_customer_revenue",
};

const RECORD_ORDER = [
  "record_canonical_input",
  "record_financials_2024",
  "record_financials_primary",
  "record_001",
];

export function tenantForCase(caseId: string): string {
  const safe = caseId.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  return `ten_${safe || "case"}`;
}

export interface PlatformFactCitation {
  sourceId: string;
  documentId?: string;
  currency?: string;
  period?: { start: string; end: string };
}

export interface PlatformFactsPost {
  values: Record<string, number>;
  currency?: string;
  period?: { start: string; end: string };
  citations: Record<string, PlatformFactCitation>;
}

export function platformFacts(
  pkg: Pick<CasePackage, "records">,
): Record<string, number> {
  return collectPlatformFacts({ ...pkg, documents: [] }).values;
}

/**
 * Numeric facts plus the public src_* / doc_* ids, currency, and statement
 * period from the case package. Does not read private or expected files.
 */
export function platformFactsPost(
  pkg: Pick<CasePackage, "records" | "documents">,
): PlatformFactsPost {
  return collectPlatformFacts(pkg);
}

export function platformFactsRequestBody(
  pkg: Pick<CasePackage, "records" | "documents">,
): Record<string, unknown> {
  const posted = platformFactsPost(pkg);
  return {
    ...posted.values,
    ...(posted.currency ? { currency: posted.currency } : {}),
    ...(posted.period ? { period: posted.period } : {}),
    citations: posted.citations,
  };
}

/** Public document ids for the upload form. Internal aliases are omitted. */
export function platformDocumentFields(
  document: Pick<CaseDocument, "sourceId" | "documentId">,
): { sourceId?: string; documentId?: string } {
  const sourceId = publicSourceId(document.sourceId);
  const documentId = publicDocumentId(document.documentId);
  return {
    ...(sourceId ? { sourceId } : {}),
    ...(documentId ? { documentId } : {}),
  };
}

/**
 * Upload basename is the public documentId plus an extension, so a stored
 * path such as `cases/opaque_…/doc_tax_returns_2022_2024.txt` still contains
 * the case document id. Display filenames are not used in its place.
 */
export function platformUploadFileName(
  document: Pick<CaseDocument, "documentId" | "fileName" | "mimeType">,
): string {
  const documentId = publicDocumentId(document.documentId);
  const ext = uploadExtension(document.fileName, document.mimeType);
  if (documentId) return `${documentId}${ext}`;
  const fallback = (document.fileName || `${document.documentId}${ext}`)
    .split(/[/\\]/)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 120);
  return fallback && fallback.length > 0 ? fallback : `statement${ext}`;
}

function uploadExtension(
  fileName: string | undefined,
  mimeType: string | undefined,
): string {
  const base = fileName?.split(/[/\\]/).pop() ?? "";
  const fromName = base.match(/(\.[A-Za-z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  return ".txt";
}

export function platformPackBody(policies: CasePolicyRule[]): {
  products: { template: string; name: string }[];
  eligibility: {
    id: string;
    field: string;
    op: "gte" | "lte" | "eq";
    value: number;
    onFail: "refer" | "decline";
  }[];
  testCases: { id: string; facts: Record<string, number>; expect: string }[];
} {
  const eligibility: {
    id: string;
    field: string;
    op: "gte" | "lte" | "eq";
    value: number;
    onFail: "refer" | "decline";
  }[] = [];
  for (const rule of policies) {
    const field =
      typeof rule.input["ratio"] === "string" ? rule.input["ratio"] : "";
    const op = platformOp(rule.operator);
    const value =
      typeof rule.threshold === "number"
        ? rule.threshold
        : Number(rule.threshold);
    if (!field || !op || !Number.isFinite(value)) continue;
    eligibility.push({
      id: rule.ruleId,
      field,
      op,
      value,
      onFail: /decline/i.test(rule.onFailure)
        ? ("decline" as const)
        : ("refer" as const),
    });
  }
  if (eligibility.length === 0) {
    return {
      products: [{ template: "credit", name: "Term loan" }],
      eligibility: [],
      testCases: [{ id: "t_empty", facts: {}, expect: "insufficient" }],
    };
  }
  const facts: Record<string, number> = {};
  for (const rule of eligibility) facts[rule.field] = rule.value;
  return {
    products: [{ template: "credit", name: "Term loan" }],
    eligibility,
    testCases: [{ id: "t_pass", facts, expect: "allow_human" }],
  };
}

export async function runPlatformPath(
  request: RunRequest,
  config: PlatformPathConfig,
  signal?: AbortSignal,
  discoveryHint?: unknown,
): Promise<PlatformPathRunResult> {
  throwIfAborted(signal);
  const fetchImpl = config.fetchImpl ?? fetch;
  const pkg = await loadCasePackage(request, fetchImpl, discoveryHint);
  throwIfAborted(signal);
  const tenantId = tenantForCase(request.caseId);
  const caseId = request.caseId;
  const api = (method: string, path: string, body?: unknown) =>
    platformFetch(
      config.baseUrl,
      tenantId,
      config.actor,
      method,
      path,
      body,
      fetchImpl,
      signal,
    );

  await api("POST", "/v1/cases", { id: caseId, tenantId });
  const facts = platformFactsPost(pkg);
  if (Object.keys(facts.values).length > 0) {
    await api(
      "POST",
      `/v1/cases/${encodeURIComponent(caseId)}/facts`,
      platformFactsRequestBody(pkg),
    );
  }
  for (const document of pkg.documents) {
    if (!document.bytes?.length) continue;
    await uploadDocument(config, tenantId, caseId, document, fetchImpl, signal);
  }
  const packId = `pack_${tenantId}`;
  await api("POST", "/v1/packs", {
    id: packId,
    tenantId,
    ...platformPackBody(pkg.policies ?? []),
  });
  await api("POST", `/v1/packs/${encodeURIComponent(packId)}/activate`, {
    actorUserId: config.actor,
  });
  const job = await api(
    "POST",
    `/v1/cases/${encodeURIComponent(caseId)}/jobs`,
    {
      pipeline: "underwrite",
      generateMemo: false,
    },
  );
  const jobId = stringField(asRecord(job), "id");
  if (jobId && stringField(asRecord(job), "status") === "queued") {
    await waitForJob(api, jobId);
  }
  const drafted = await draftMemo(config, tenantId, caseId, fetchImpl, signal);
  // Submission cells come from draft_memo_from_file structuredContent, not
  // from the underwrite job body.
  const mapped = mapPlatformDraft(
    pkg,
    drafted,
    config.mappingMode ?? "passthrough",
    {
      workspaceId: caseId,
      workspaceName: tenantId,
    },
  );
  await pkg.client.tryCall(
    "submission.save_artifact",
    platformRunArtifact(caseId, mapped.submission, mapped.metadata),
  );
  return {
    submission: mapped.submission,
    workspaceId: caseId,
    workspaceName: tenantId,
    decision: mapped.decision,
    metadata: mapped.metadata,
  };
}

/**
 * Passthrough submits the platform draft as returned. `shaped` is the previous
 * case-package mapping (liquidity override, pack risks, pack spread).
 */
export function mapPlatformDraft(
  pkg: CasePackage,
  draft: unknown,
  mode: SubmissionMappingMode,
  ids: { workspaceId: string; workspaceName: string },
): {
  submission: UnderwritingSubmission;
  metadata: AdapterMappingMetadata;
  decision: string;
} {
  if (mode === "passthrough") {
    const mapped = mapPlatformPassthrough(draft, ids.workspaceId);
    return {
      submission: mapped.submission,
      metadata: mapped.metadata,
      decision: mapped.submission.recommendation.decision,
    };
  }
  const record = asRecord(draft);
  const decision = stringField(
    asRecord(record?.["recommendation"]),
    "decision",
  );
  const markdown = stringField(record, "body") ?? "";
  if (!decision || !DECISIONS.has(decision)) {
    throw new Error(
      `draft_memo_from_file returned no bench decision for ${ids.workspaceId}`,
    );
  }
  return {
    submission: mapChatPathToSubmission(pkg, {
      workspaceId: ids.workspaceId,
      workspaceName: ids.workspaceName,
      memo: {
        markdown,
        recommendation: { decision },
      },
    }),
    metadata: { adapterMode: "shaped" },
    decision,
  };
}

/** Saved into the run folder via submission.save_artifact so the mode is visible. */
export function platformRunArtifact(
  caseId: string,
  submission: UnderwritingSubmission,
  metadata: AdapterMappingMetadata,
): { artifactId: string; content: string; contentType: string } {
  if (metadata.adapterMode === "shaped") {
    return {
      artifactId: `${caseId}-securelend-memo`,
      content: submission.memo.markdown,
      contentType: "text/markdown",
    };
  }
  return {
    artifactId: `${caseId}-adapter-manifest`,
    content: JSON.stringify(
      { ...metadata, memoMarkdown: submission.memo.markdown },
      null,
      2,
    ),
    contentType: "application/json",
  };
}

interface FactOrigin {
  value: number;
  sourceId?: string;
  documentId?: string;
  currency?: string;
  period?: { start: string; end: string };
}

function collectPlatformFacts(
  pkg: Pick<CasePackage, "records" | "documents">,
): PlatformFactsPost {
  const ordered = orderedRecords(pkg.records);
  const origins: Record<string, FactOrigin> = {};
  for (const item of ordered) absorbRecord(origins, item, pkg.documents);
  const revenue = origins["revenue"]?.value;
  if (
    origins["top_customer_revenue"] === undefined &&
    typeof revenue === "number"
  ) {
    const share = shareFraction(ordered);
    if (share !== undefined) {
      const from = shareRecord(ordered);
      const sourceId = publicSourceId(from?.sourceId);
      const cited = citationFromEvidence(from?.record["evidence"]);
      origins["top_customer_revenue"] = {
        value: share * revenue,
        ...(cited.sourceId
          ? { sourceId: cited.sourceId }
          : sourceId
            ? { sourceId }
            : {}),
        ...(cited.documentId ? { documentId: cited.documentId } : {}),
      };
    }
  }
  const statement = statementContext(ordered);
  const values: Record<string, number> = {};
  const citations: Record<string, PlatformFactCitation> = {};
  for (const [key, origin] of Object.entries(origins)) {
    values[key] = origin.value;
    const sourceId = origin.sourceId;
    if (!sourceId) continue;
    const currency = origin.currency ?? statement.currency;
    const period = origin.period ?? statement.period;
    const documentId =
      origin.documentId ?? documentForSource(sourceId, pkg.documents);
    citations[key] = {
      sourceId,
      ...(documentId ? { documentId } : {}),
      ...(currency ? { currency } : {}),
      ...(period ? { period } : {}),
    };
  }
  return {
    values,
    ...(statement.currency ? { currency: statement.currency } : {}),
    ...(statement.period ? { period: statement.period } : {}),
    citations,
  };
}

function orderedRecords(records: CaseRecord[]): CaseRecord[] {
  return [
    ...RECORD_ORDER.map((id) =>
      records.find((row) => row.recordId === id),
    ).filter((row): row is CaseRecord => row !== undefined),
    ...records.filter((row) => !RECORD_ORDER.includes(row.recordId)),
  ];
}

function absorbRecord(
  facts: Record<string, FactOrigin>,
  item: CaseRecord,
  documents: CaseDocument[],
): void {
  const next: Record<string, FactOrigin> = {};
  const spread =
    asRecord(item.record["financialSpread"]) ??
    asRecord(item.record["spread"]) ??
    item.record;
  const spreadCurrency = publicCurrency(spread["currency"]);
  const spreadPeriod = periodOf(spread["period"]);
  const recordSource = publicSourceId(item.sourceId);
  for (const [key, target] of Object.entries(SPREAD_FIELDS)) {
    const amount = amountOf(spread[key]);
    if (amount === undefined) continue;
    next[target] = originFrom(amount, {
      sourceId: recordSource,
      currency: spreadCurrency,
      period: spreadPeriod,
      documentId: documentForSource(recordSource, documents),
    });
  }
  const listed = item.record["normalizedFacts"];
  if (Array.isArray(listed)) {
    for (const row of listed) {
      const fact = asRecord(row);
      const key =
        typeof fact?.["canonicalKey"] === "string" ? fact["canonicalKey"] : "";
      const target = SPREAD_FIELDS[key];
      const amount = amountOf(fact?.["value"]);
      if (!target || amount === undefined) continue;
      const cited = citationFromEvidence(fact?.["evidence"]);
      const factOrigin = originFrom(amount, {
        sourceId: cited.sourceId ?? recordSource,
        documentId:
          cited.documentId ??
          documentForSource(cited.sourceId ?? recordSource, documents),
        currency: publicCurrency(fact?.["currency"]) ?? spreadCurrency,
        period: periodOf(fact?.["period"]) ?? spreadPeriod,
      });
      const existing = next[target];
      if (!existing) {
        next[target] = factOrigin;
        continue;
      }
      if (!existing.sourceId && factOrigin.sourceId)
        existing.sourceId = factOrigin.sourceId;
      if (!existing.documentId && factOrigin.documentId) {
        existing.documentId = factOrigin.documentId;
      }
      if (!existing.currency && factOrigin.currency)
        existing.currency = factOrigin.currency;
      if (!existing.period && factOrigin.period)
        existing.period = factOrigin.period;
    }
  }
  for (const [target, origin] of Object.entries(next)) {
    const existing = facts[target];
    if (!existing) {
      facts[target] = origin;
      continue;
    }
    if (!existing.sourceId && origin.sourceId)
      existing.sourceId = origin.sourceId;
    if (!existing.documentId && origin.documentId)
      existing.documentId = origin.documentId;
    if (!existing.currency && origin.currency)
      existing.currency = origin.currency;
    if (!existing.period && origin.period) existing.period = origin.period;
  }
}

function originFrom(
  value: number,
  parts: {
    sourceId?: string | undefined;
    documentId?: string | undefined;
    currency?: string | undefined;
    period?: { start: string; end: string } | undefined;
  },
): FactOrigin {
  return {
    value,
    ...(parts.sourceId ? { sourceId: parts.sourceId } : {}),
    ...(parts.documentId ? { documentId: parts.documentId } : {}),
    ...(parts.currency ? { currency: parts.currency } : {}),
    ...(parts.period ? { period: parts.period } : {}),
  };
}

function statementContext(records: CaseRecord[]): {
  currency?: string;
  period?: { start: string; end: string };
} {
  for (const item of records) {
    const spread =
      asRecord(item.record["financialSpread"]) ??
      asRecord(item.record["spread"]);
    if (!spread) continue;
    const currency = publicCurrency(spread["currency"]);
    const period = periodOf(spread["period"]);
    if (currency || period) {
      return {
        ...(currency ? { currency } : {}),
        ...(period ? { period } : {}),
      };
    }
  }
  return {};
}

function citationFromEvidence(value: unknown): {
  sourceId?: string;
  documentId?: string;
} {
  if (!Array.isArray(value)) return {};
  for (const item of value) {
    const row = asRecord(item);
    const sourceId = publicSourceId(row?.["sourceId"]);
    const documentId = publicDocumentId(row?.["documentId"]);
    if (!sourceId && !documentId) continue;
    return {
      ...(sourceId ? { sourceId } : {}),
      ...(documentId ? { documentId } : {}),
    };
  }
  return {};
}

function documentForSource(
  sourceId: string | undefined,
  documents: CaseDocument[],
): string | undefined {
  if (!sourceId) return undefined;
  const match = documents.find(
    (document) =>
      document.sourceId === sourceId && publicDocumentId(document.documentId),
  );
  return match ? publicDocumentId(match.documentId) : undefined;
}

function publicSourceId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^src_[A-Za-z0-9_]+$/.test(value) &&
    isCitableSourceId(value)
    ? value
    : undefined;
}

function publicDocumentId(value: unknown): string | undefined {
  return typeof value === "string" && /^doc_[A-Za-z0-9_]+$/.test(value)
    ? value
    : undefined;
}

function publicCurrency(value: unknown): string | undefined {
  const parsed = Iso4217CurrencySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function periodOf(value: unknown): { start: string; end: string } | undefined {
  const record = asRecord(value);
  const start = record?.["start"];
  const end = record?.["end"];
  if (typeof start !== "string" || typeof end !== "string") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return undefined;
  }
  return { start, end };
}

function shareRecord(records: CaseRecord[]): CaseRecord | undefined {
  for (const item of records) {
    for (const key of ["top_1_pct", "top_customer_pct"]) {
      if (amountOf(item.record[key]) !== undefined) return item;
    }
  }
  return undefined;
}

function shareFraction(records: CasePackage["records"]): number | undefined {
  for (const item of records) {
    for (const key of ["top_1_pct", "top_customer_pct"]) {
      const value = amountOf(item.record[key]);
      if (value === undefined) continue;
      return value > 1 ? value / 100 : value;
    }
  }
  return undefined;
}

function amountOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const record = asRecord(value);
  if (
    record &&
    typeof record["amount"] === "number" &&
    Number.isFinite(record["amount"])
  ) {
    return record["amount"];
  }
  return undefined;
}

function platformOp(operator: string): "gte" | "lte" | "eq" | undefined {
  switch (operator) {
    case ">=":
    case "gte":
    case "ge":
      return "gte";
    case "<=":
    case "lte":
    case "le":
      return "lte";
    case "=":
    case "==":
    case "eq":
      return "eq";
    default:
      return undefined;
  }
}

async function platformFetch(
  baseUrl: string,
  tenantId: string,
  actor: string,
  method: string,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer test.human.${tenantId}.${actor}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal) init.signal = signal;
  const response = await fetchImpl(`${baseUrl}${path}`, init);
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (response.status >= 400) {
    throw new Error(
      `${method} ${path} failed ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return parsed;
}

async function uploadDocument(
  config: PlatformPathConfig,
  tenantId: string,
  caseId: string,
  document: CasePackage["documents"][number],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  const filename = platformUploadFileName(document);
  const form = new FormData();
  form.set("caseId", caseId);
  const ids = platformDocumentFields(document);
  if (ids.sourceId) form.set("sourceId", ids.sourceId);
  if (ids.documentId) form.set("documentId", ids.documentId);
  form.set(
    "file",
    new Blob([Uint8Array.from(document.bytes)], {
      type: document.mimeType || "text/plain",
    }),
    filename,
  );
  const init: RequestInit = {
    method: "POST",
    headers: { authorization: `Bearer test.human.${tenantId}.${config.actor}` },
    body: form,
  };
  if (signal) init.signal = signal;
  const response = await fetchImpl(
    `${config.baseUrl}/v1/documents/upload`,
    init,
  );
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(
      `upload ${filename} failed ${response.status}: ${text.slice(0, 300)}`,
    );
  }
}

async function draftMemo(
  config: PlatformPathConfig,
  tenantId: string,
  caseId: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer test.human.${tenantId}.${config.actor}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "draft_memo_from_file", arguments: { caseId } },
    }),
  };
  if (signal) init.signal = signal;
  const response = await fetchImpl(`${config.baseUrl}/v1/lender/mcp`, init);
  const payload = (await response.json()) as {
    result?: {
      structuredContent?: unknown;
      isError?: boolean;
      content?: { text?: string }[];
    };
    error?: { message?: string };
  };
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message ||
        `draft_memo_from_file failed ${response.status}`,
    );
  }
  if (payload.result?.isError) {
    throw new Error(
      payload.result.content?.[0]?.text || "draft_memo_from_file failed",
    );
  }
  return payload.result?.structuredContent ?? null;
}

async function waitForJob(
  api: (method: string, path: string) => Promise<unknown>,
  jobId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = asRecord(
      await api("GET", `/v1/jobs/${encodeURIComponent(jobId)}`),
    );
    const status = stringField(job, "status");
    if (status === "complete" || status === "blocked") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`walk ${jobId} did not finish`);
}

function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  }
}
