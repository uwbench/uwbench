import type { RunRequest, UnderwritingSubmission } from "@uwbench/protocol";
import { loadCasePackage, type CasePackage, type CasePolicyRule } from "./case-package.js";
import { asRecord } from "./mcp-client.js";
import { mapChatPathToSubmission } from "./submission-map.js";

export interface PlatformPathConfig {
  baseUrl: string;
  actor: string;
  fetchImpl?: typeof fetch;
}

export interface PlatformPathRunResult {
  submission: UnderwritingSubmission;
  workspaceId: string;
  workspaceName: string;
  decision: string;
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

export function platformFacts(pkg: Pick<CasePackage, "records">): Record<string, number> {
  const facts: Record<string, number> = {};
  const ordered = [
    ...RECORD_ORDER.map((id) => pkg.records.find((row) => row.recordId === id)).filter(
      (row): row is CasePackage["records"][number] => row !== undefined,
    ),
    ...pkg.records.filter((row) => !RECORD_ORDER.includes(row.recordId)),
  ];
  for (const item of ordered) absorbRecord(facts, item.record);
  const revenue = facts["revenue"];
  if (facts["top_customer_revenue"] === undefined && typeof revenue === "number") {
    const share = shareFraction(ordered);
    if (share !== undefined) facts["top_customer_revenue"] = share * revenue;
  }
  return facts;
}

export function platformPackBody(
  policies: CasePolicyRule[],
): {
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
  const eligibility = policies.map((rule) => {
    const field = typeof rule.input["ratio"] === "string" ? rule.input["ratio"] : "";
    const op = platformOp(rule.operator);
    const value = typeof rule.threshold === "number" ? rule.threshold : Number(rule.threshold);
    if (!field || !op || !Number.isFinite(value)) {
      throw new Error(`Cannot map policy ${rule.ruleId} (${rule.operator} ${String(rule.threshold)})`);
    }
    return {
      id: rule.ruleId,
      field,
      op,
      value,
      onFail: /decline/i.test(rule.onFailure) ? "decline" as const : "refer" as const,
    };
  });
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
    platformFetch(config.baseUrl, tenantId, config.actor, method, path, body, fetchImpl, signal);

  await api("POST", "/v1/cases", { id: caseId, tenantId });
  const facts = platformFacts(pkg);
  if (Object.keys(facts).length > 0) {
    await api("POST", `/v1/cases/${encodeURIComponent(caseId)}/facts`, facts);
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
  const job = await api("POST", `/v1/cases/${encodeURIComponent(caseId)}/jobs`, {
    pipeline: "underwrite",
    generateMemo: false,
  });
  const jobId = stringField(asRecord(job), "id");
  if (jobId && stringField(asRecord(job), "status") === "queued") {
    await waitForJob(api, jobId);
  }
  const drafted = await draftMemo(config, tenantId, caseId, fetchImpl, signal);
  const decision = stringField(asRecord(asRecord(drafted)?.["recommendation"]), "decision");
  const markdown = stringField(asRecord(drafted), "body") ?? "";
  if (!decision || !DECISIONS.has(decision)) {
    throw new Error(`draft_memo_from_file returned no bench decision for ${caseId}`);
  }
  const submission = mapChatPathToSubmission(pkg, {
    workspaceId: caseId,
    workspaceName: tenantId,
    memo: {
      markdown,
      recommendation: { decision },
    },
  });
  await pkg.client.tryCall("submission.save_artifact", {
    artifactId: `${caseId}-securelend-memo`,
    content: submission.memo.markdown,
    contentType: "text/markdown",
  });
  return {
    submission,
    workspaceId: caseId,
    workspaceName: tenantId,
    decision,
  };
}

function absorbRecord(facts: Record<string, number>, record: Record<string, unknown>): void {
  const spread = asRecord(record["financialSpread"]) ?? asRecord(record["spread"]) ?? record;
  for (const [key, target] of Object.entries(SPREAD_FIELDS)) {
    const amount = amountOf(spread[key]);
    if (amount !== undefined) facts[target] = amount;
  }
  const listed = record["normalizedFacts"];
  if (!Array.isArray(listed)) return;
  for (const item of listed) {
    const row = asRecord(item);
    const key = typeof row?.["canonicalKey"] === "string" ? row["canonicalKey"] : "";
    const target = SPREAD_FIELDS[key];
    const amount = amountOf(row?.["value"]);
    if (target && amount !== undefined) facts[target] = amount;
  }
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
  if (record && typeof record["amount"] === "number" && Number.isFinite(record["amount"])) {
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
  const parsed = text ? JSON.parse(text) as unknown : null;
  if (response.status >= 400) {
    throw new Error(`${method} ${path} failed ${response.status}: ${text.slice(0, 500)}`);
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
  const filename = (document.fileName || `${document.documentId}.txt`)
    .split(/[/\\]/)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 120) || "statement.txt";
  const form = new FormData();
  form.set("caseId", caseId);
  form.set(
    "file",
    new Blob([Uint8Array.from(document.bytes)], { type: document.mimeType || "text/plain" }),
    filename,
  );
  const init: RequestInit = {
    method: "POST",
    headers: { authorization: `Bearer test.human.${tenantId}.${config.actor}` },
    body: form,
  };
  if (signal) init.signal = signal;
  const response = await fetchImpl(`${config.baseUrl}/v1/documents/upload`, init);
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(`upload ${filename} failed ${response.status}: ${text.slice(0, 300)}`);
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
  const payload = await response.json() as {
    result?: { structuredContent?: unknown; isError?: boolean; content?: { text?: string }[] };
    error?: { message?: string };
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `draft_memo_from_file failed ${response.status}`);
  }
  if (payload.result?.isError) {
    throw new Error(payload.result.content?.[0]?.text || "draft_memo_from_file failed");
  }
  return payload.result?.structuredContent ?? null;
}

async function waitForJob(
  api: (method: string, path: string) => Promise<unknown>,
  jobId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = asRecord(await api("GET", `/v1/jobs/${encodeURIComponent(jobId)}`));
    const status = stringField(job, "status");
    if (status === "complete" || status === "blocked") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`walk ${jobId} did not finish`);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
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
