import { asRecord } from "./mcp-client.js";

/**
 * First-class product fields we must not drop. Reporting only — never
 * writes proposedDecision and never branches by task id.
 */
const FIELD_ALIASES = {
  workspaceId: ["workspaceId", "workspace_id"],
  jobId: ["jobId", "job_id", "memoJobId"],
  memoId: ["memoId", "memo_id"],
  proposedDecision: ["proposedDecision", "proposed_decision"],
  documentChase: ["documentChase", "document_chase"],
  missingDiligence: ["missingDiligence", "missing_diligence"],
  fileStatus: ["fileStatus", "file_status"],
} as const;

export type ProductTraceField = keyof typeof FIELD_ALIASES;

export type ProductTrace = {
  [K in ProductTraceField]?: unknown;
};

const WRAPPER_KEYS = [
  "productTrace",
  "product_trace",
  "memo",
  "result",
  "fullResult",
  "workspace",
  "data",
  "payload",
] as const;

export function pickProductTrace(value: unknown): ProductTrace {
  const out: ProductTrace = {};
  for (const record of recordsToScan(value)) {
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (out[field as ProductTraceField] !== undefined) continue;
      const found = pickField(record, aliases);
      if (found !== undefined) out[field as ProductTraceField] = found;
    }
  }
  return compactProductTrace(out) ?? {};
}

export function mergeProductTrace(
  ...layers: Array<ProductTrace | undefined>
): ProductTrace | undefined {
  const out: ProductTrace = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined || value === null) continue;
      if (out[key as ProductTraceField] !== undefined) continue;
      out[key as ProductTraceField] = value;
    }
  }
  return compactProductTrace(out);
}

export function compactProductTrace(
  value: ProductTrace,
): ProductTrace | undefined {
  const out: ProductTrace = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    if (typeof item === "string" && !item.trim()) continue;
    out[key as ProductTraceField] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function productTraceFromError(
  error: unknown,
): ProductTrace | undefined {
  if (!error || typeof error !== "object") return undefined;
  const attached = (error as { productTrace?: unknown }).productTrace;
  const picked = pickProductTrace(attached);
  return compactProductTrace(picked);
}

export function attachProductTrace(
  error: unknown,
  productTrace: ProductTrace | undefined,
): never {
  const compact = compactProductTrace(productTrace ?? {});
  if (error instanceof Error) {
    if (compact) {
      (error as Error & { productTrace?: ProductTrace }).productTrace =
        compact;
    }
    throw error;
  }
  const wrapped = new Error(String(error));
  if (compact) {
    (wrapped as Error & { productTrace?: ProductTrace }).productTrace =
      compact;
  }
  throw wrapped;
}

function pickField(
  record: Record<string, unknown>,
  aliases: readonly string[],
): unknown {
  for (const key of aliases) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function recordsToScan(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value);
  if (!root) return [];
  const out: Record<string, unknown>[] = [root];
  for (const key of WRAPPER_KEYS) {
    const nested = asRecord(root[key]);
    if (nested) out.push(nested);
  }
  return out;
}
