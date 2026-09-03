/**
 * Read the product chase / completeness payload. Reporting only — never
 * writes proposedDecision and never branches by task id.
 */
export interface ProductChaseGap {
  key: string;
  items: string[];
}

const GAP_KEYS = [
  "missingDocuments",
  "missing_documents",
  "missingDocs",
  "missing_docs",
  "requiredDocuments",
  "required_documents",
  "unsatisfiedRequirements",
  "unsatisfied_requirements",
  "chaseRequirements",
  "chase_requirements",
  "outstandingDocuments",
  "outstanding_documents",
  "missingEvidence",
  "missing_evidence",
  "insufficientReasons",
  "insufficient_reasons",
  "followUpRequests",
  "follow_up_requests",
  "stipulations",
  "stips",
  "completenessGaps",
  "completeness_gaps",
  "documentChase",
  "document_chase",
  "missingDiligence",
  "missing_diligence",
  "fileStatus",
  "file_status",
] as const;

export function chaseGapsFromUnknown(value: unknown): ProductChaseGap[] {
  const found = new Map<string, string[]>();
  const seen = new Set<unknown>();
  const visit = (node: unknown, parentKey?: string): void => {
    if (node === undefined || node === null || seen.has(node)) return;
    if (typeof node !== "object") return;
    seen.add(node);
    if (Array.isArray(node)) {
      if (parentKey && isGapKey(parentKey)) {
        const items = stringifyGapItems(node);
        if (items.length > 0) merge(found, parentKey, items);
      }
      for (const item of node) visit(item, parentKey);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      if (isGapKey(key)) {
        const items = stringifyGapItems(item);
        if (items.length > 0) merge(found, key, items);
      }
      visit(item, key);
    }
  };
  visit(value);
  return [...found.entries()].map(([key, items]) => ({ key, items }));
}

export function workspaceHintFromUnknown(value: unknown): string | undefined {
  const trace = productTraceFromUnknown(value);
  if (typeof trace?.workspaceId === "string" && trace.workspaceId.trim()) {
    return trace.workspaceId.trim();
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const direct =
    firstString(record, "workspaceId", "workspace_id") ??
    firstString(asRecord(record["workspace"]), "workspaceId", "id");
  if (direct) return direct;
  const markdown =
    firstString(record, "markdown") ??
    firstString(asRecord(record["memo"]), "markdown");
  const match = markdown?.match(/Workspace:[^\n(]*\(([^)]+)\)/i);
  return match?.[1];
}

/**
 * Raw product debug fields from /v1/runs (including the adapter's
 * productTrace sibling that protocol-schema parse would otherwise drop).
 */
export interface ProductTraceReport {
  workspaceId?: unknown;
  jobId?: unknown;
  memoId?: unknown;
  proposedDecision?: unknown;
  documentChase?: unknown;
  missingDiligence?: unknown;
  fileStatus?: unknown;
}

const TRACE_FIELDS = [
  ["workspaceId", "workspaceId", "workspace_id"],
  ["jobId", "jobId", "job_id", "memoJobId"],
  ["memoId", "memoId", "memo_id"],
  ["proposedDecision", "proposedDecision", "proposed_decision"],
  ["documentChase", "documentChase", "document_chase"],
  ["missingDiligence", "missingDiligence", "missing_diligence"],
  ["fileStatus", "fileStatus", "file_status"],
] as const;

const TRACE_WRAPPERS = [
  "productTrace",
  "product_trace",
  "result",
  "memo",
  "fullResult",
  "workspace",
  "data",
] as const;

export function productTraceFromUnknown(
  value: unknown,
): ProductTraceReport | undefined {
  const out: ProductTraceReport = {};
  for (const record of traceRecords(value)) {
    for (const [field, ...aliases] of TRACE_FIELDS) {
      if (out[field] !== undefined) continue;
      const found = pickUnknown(record, aliases);
      if (found !== undefined) out[field] = found;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function traceRecords(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value);
  if (!root) return [];
  const out: Record<string, unknown>[] = [root];
  for (const key of TRACE_WRAPPERS) {
    const nested = asRecord(root[key]);
    if (nested) out.push(nested);
  }
  return out;
}

function pickUnknown(
  record: Record<string, unknown>,
  aliases: readonly string[],
): unknown {
  for (const key of aliases) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function isGapKey(key: string): boolean {
  return (GAP_KEYS as readonly string[]).includes(key);
}

function stringifyGapItems(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) {
    const record = asRecord(value);
    if (!record) return [];
    const labeled =
      firstString(record, "requirement", "document", "name", "id", "code") ??
      firstString(record, "reason", "message", "detail");
    return labeled ? [labeled] : [];
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      items.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const labeled =
      firstString(record, "requirement", "document", "name", "id", "code") ??
      firstString(record, "reason", "message", "detail", "claim", "statement");
    if (labeled) items.push(labeled);
  }
  return unique(items);
}

function merge(
  found: Map<string, string[]>,
  key: string,
  items: string[],
): void {
  const existing = found.get(key) ?? [];
  found.set(key, unique([...existing, ...items]));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function firstString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
