import {
  CitedClaimSchema,
  ComplianceFindingSchema,
  ConditionSchema,
  ConfidenceSchema,
  DecisionSchema,
  DiscrepancySchema,
  EvidenceReferenceSchema,
  FinancialSpreadSchema,
  FollowUpRequestSchema,
  NormalizedFactSchema,
  PolicyAssessmentSchema,
  PolicyExceptionSchema,
  RecommendationSchema,
  RiskFindingSchema,
  UnderwritingSubmissionSchema,
  UsageSchema,
  type CitedClaim,
  type Decision,
  type EvidenceReference,
  type FinancialSpread,
  type UnderwritingSubmission,
} from "@uwbench/protocol";
import { asRecord, firstString } from "./mcp-client.js";

/**
 * What the desk profile does when `draft_memo_from_file` does not return a
 * spread that satisfies `FinancialSpreadSchema`.
 *
 * The submission still needs a `financialSpread` object, so it uses the schema
 * placeholder: currency `XXX`, period `1970-01-01`/`1970-01-01`, revenue `0`.
 * That placeholder is not a case-package number. Amounts from the case package
 * are not copied in. A spread object that is present but fails the schema is
 * treated the same way, and the parse error is listed in `dropped`.
 */
export const MISSING_PLATFORM_SPREAD_NOTE =
  "The platform draft did not include a financialSpread or spread that satisfies FinancialSpreadSchema. The submission uses the schema placeholder (currency XXX, period 1970-01-01, revenue 0). The case-package spread is not copied in. A spread that is present but fails the schema is treated the same way and listed in dropped.";

export const PLATFORM_SPREAD_NOTE =
  "Platform financialSpread was submitted as returned. Case-package amounts were not merged in.";

export interface DroppedPlatformItem {
  path: string;
  reason: string;
}

export interface PlatformPassthroughMetadata {
  adapterMode: "passthrough";
  financialSpread: "platform" | "missing";
  financialSpreadNote: string;
  /** Schema rejects. Citation ids are not replaced with catalog ids. */
  dropped: DroppedPlatformItem[];
  /**
   * Schema-required numbers the platform omitted. Recorded here instead of
   * being filled in silently. Decision is never defaulted.
   */
  schemaDefaults: DroppedPlatformItem[];
}

export interface PlatformPassthroughResult {
  submission: UnderwritingSubmission;
  metadata: PlatformPassthroughMetadata;
}

const RISK_KEYS = [
  "risks",
  "riskFindings",
  "risk_findings",
  "identifiedRisks",
] as const;

const CLAIM_KEYS = ["claims", "citedClaims"] as const;

export function mapPlatformPassthrough(
  draft: unknown,
  caseId = "",
): PlatformPassthroughResult {
  const record = asRecord(draft) ?? {};
  const memo = asRecord(record["memo"]);
  const dropped: DroppedPlatformItem[] = [];
  const schemaDefaults: DroppedPlatformItem[] = [];
  const decision = readDecision(record, memo);
  if (!decision) {
    const suffix = caseId ? ` for ${caseId}` : "";
    throw new Error(`draft_memo_from_file returned no bench decision${suffix}`);
  }

  const spread = readSpread(record, memo, dropped);
  const recommendation =
    asRecord(record["recommendation"]) ??
    asRecord(memo?.["recommendation"]) ??
    {};
  const risks = parseRisks(
    readList(record, memo, RISK_KEYS, "risks", dropped),
    dropped,
    schemaDefaults,
  );
  const facts = parseFacts(
    readList(
      record,
      memo,
      ["normalizedFacts", "facts"],
      "normalizedFacts",
      dropped,
    ),
    dropped,
    schemaDefaults,
  );
  const claims = parseClaims(
    readList(record, memo, CLAIM_KEYS, "memo.claims", dropped),
    "memo.claims",
    dropped,
    schemaDefaults,
  );
  const rationale = parseClaims(
    readList(
      recommendation,
      undefined,
      ["rationale"],
      "recommendation.rationale",
      dropped,
    ),
    "recommendation.rationale",
    dropped,
    schemaDefaults,
  );

  const submission = UnderwritingSubmissionSchema.parse({
    schemaVersion: "1.0",
    financialSpread: spread.spread,
    normalizedFacts: facts,
    risks,
    discrepancies: parseItems(
      readList(record, memo, ["discrepancies"], "discrepancies", dropped),
      DiscrepancySchema,
      "discrepancies",
      dropped,
    ),
    complianceFindings: parseItems(
      readList(
        record,
        memo,
        ["complianceFindings"],
        "complianceFindings",
        dropped,
      ),
      ComplianceFindingSchema,
      "complianceFindings",
      dropped,
    ),
    followUpRequests: parseItems(
      readList(record, memo, ["followUpRequests"], "followUpRequests", dropped),
      FollowUpRequestSchema,
      "followUpRequests",
      dropped,
    ),
    policyAssessment: readPolicyAssessment(record, memo, dropped),
    recommendation: {
      decision,
      confidence: readUnitInterval(
        recommendation["confidence"],
        "recommendation.confidence",
        schemaDefaults,
      ),
      ...optionalRecommendationFields(recommendation, dropped),
      conditions: parseItems(
        arrayOrEmpty(
          recommendation["conditions"],
          "recommendation.conditions",
          dropped,
        ),
        ConditionSchema,
        "recommendation.conditions",
        dropped,
      ),
      policyExceptions: parseItems(
        arrayOrEmpty(
          recommendation["policyExceptions"],
          "recommendation.policyExceptions",
          dropped,
        ),
        PolicyExceptionSchema,
        "recommendation.policyExceptions",
        dropped,
      ),
      rationale,
    },
    memo: {
      markdown: memoMarkdown(record, memo),
      claims,
    },
    confidence: readConfidence(record, schemaDefaults),
    ...readUsage(record, dropped),
  });

  return {
    submission,
    metadata: {
      adapterMode: "passthrough",
      financialSpread: spread.source,
      financialSpreadNote:
        spread.source === "platform"
          ? PLATFORM_SPREAD_NOTE
          : MISSING_PLATFORM_SPREAD_NOTE,
      dropped,
      schemaDefaults,
    },
  };
}

function readDecision(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
): Decision | undefined {
  const recommendation = asRecord(record["recommendation"]);
  const nested = asRecord(memo?.["recommendation"]);
  const candidates = [
    recommendation?.["decision"],
    record["decision"],
    nested?.["decision"],
    memo?.["decision"],
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue;
    }
    const parsed = DecisionSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  }
  return undefined;
}

function readSpread(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
  dropped: DroppedPlatformItem[],
): { spread: FinancialSpread; source: "platform" | "missing" } {
  const located = locateSpread(record, memo);
  if (!located) return { spread: placeholderSpread(), source: "missing" };
  const parsed = FinancialSpreadSchema.safeParse(located.value);
  if (parsed.success) return { spread: parsed.data, source: "platform" };
  dropped.push({
    path: located.path,
    reason: issueText(parsed.error),
  });
  return { spread: placeholderSpread(), source: "missing" };
}

function locateSpread(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
): { path: string; value: unknown } | undefined {
  for (const [path, value] of [
    ["financialSpread", record["financialSpread"]],
    ["spread", record["spread"]],
    ["memo.financialSpread", memo?.["financialSpread"]],
    ["memo.spread", memo?.["spread"]],
  ] as const) {
    if (value !== undefined && value !== null) return { path, value };
  }
  return undefined;
}

function placeholderSpread(): FinancialSpread {
  return {
    revenue: { amount: 0, currency: "XXX" },
    period: { start: "1970-01-01", end: "1970-01-01" },
    currency: "XXX",
    scale: "units",
    signConvention: "all_positive",
  };
}

function readList(
  record: Record<string, unknown>,
  nested: Record<string, unknown> | undefined,
  keys: readonly string[],
  path: string,
  dropped: DroppedPlatformItem[],
): unknown[] {
  const top = listAt(record, keys, path, dropped);
  if (top.found) return top.items;
  if (!nested) return [];
  const inner = listAt(nested, keys, `memo.${path}`, dropped);
  return inner.found ? inner.items : [];
}

function listAt(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  dropped: DroppedPlatformItem[],
): { found: boolean; items: unknown[] } {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (Array.isArray(value)) return { found: true, items: value };
    if (typeof value === "string") {
      const parsed = parseJsonArray(value);
      if (parsed) return { found: true, items: parsed };
    }
    dropped.push({
      path: `${path}.${key}`,
      reason: "platform field is not an array",
    });
    return { found: true, items: [] };
  }
  return { found: false, items: [] };
}

function arrayOrEmpty(
  value: unknown,
  path: string,
  dropped: DroppedPlatformItem[],
): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  dropped.push({ path, reason: "platform field is not an array" });
  return [];
}

function parseRisks(
  items: unknown[],
  dropped: DroppedPlatformItem[],
  schemaDefaults: DroppedPlatformItem[],
): UnderwritingSubmission["risks"] {
  const kept: UnderwritingSubmission["risks"] = [];
  items.forEach((item, index) => {
    const path = `risks[${index}]`;
    const record = asRecord(item);
    if (!record) {
      dropped.push({ path, reason: "not an object" });
      return;
    }
    const evidence = parseEvidence(
      record["evidence"] ?? record["citations"],
      `${path}.evidence`,
      dropped,
    );
    const confidence = readUnitInterval(
      record["confidence"],
      `${path}.confidence`,
      schemaDefaults,
    );
    const parsed = RiskFindingSchema.safeParse({
      riskId: firstString(record, "riskId", "id"),
      category: firstString(record, "category"),
      severity: firstString(record, "severity"),
      statement: firstString(
        record,
        "statement",
        "description",
        "text",
        "title",
        "finding",
        "summary",
      ),
      evidence,
      confidence,
    });
    if (!parsed.success) {
      dropped.push({ path, reason: issueText(parsed.error) });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function parseFacts(
  items: unknown[],
  dropped: DroppedPlatformItem[],
  schemaDefaults: DroppedPlatformItem[],
): UnderwritingSubmission["normalizedFacts"] {
  const kept: UnderwritingSubmission["normalizedFacts"] = [];
  items.forEach((item, index) => {
    const path = `normalizedFacts[${index}]`;
    const record = asRecord(item);
    if (!record) {
      dropped.push({ path, reason: "not an object" });
      return;
    }
    const evidence = parseEvidence(
      record["evidence"],
      `${path}.evidence`,
      dropped,
    );
    if (evidence.length === 0) {
      dropped.push({
        path,
        reason:
          "dropped because NormalizedFactSchema requires at least one evidence reference",
      });
      return;
    }
    const candidate: Record<string, unknown> = {
      canonicalKey: record["canonicalKey"],
      value: record["value"],
      type: record["type"],
      evidence,
    };
    for (const key of [
      "normalizedValue",
      "unit",
      "currency",
      "scale",
      "period",
      "conflictGroup",
    ]) {
      if (record[key] !== undefined) candidate[key] = record[key];
    }
    if (typeof record["confidence"] === "number") {
      candidate["confidence"] = readUnitInterval(
        record["confidence"],
        `${path}.confidence`,
        schemaDefaults,
      );
    } else if (record["confidence"] !== undefined) {
      dropped.push({
        path: `${path}.confidence`,
        reason: "dropped with the fact because confidence is not a number",
      });
      return;
    }
    const parsed = NormalizedFactSchema.safeParse(candidate);
    if (!parsed.success) {
      dropped.push({ path, reason: issueText(parsed.error) });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function parseClaims(
  items: unknown[],
  pathPrefix: string,
  dropped: DroppedPlatformItem[],
  schemaDefaults: DroppedPlatformItem[],
): CitedClaim[] {
  const kept: CitedClaim[] = [];
  items.forEach((item, index) => {
    const path = `${pathPrefix}[${index}]`;
    const record = asRecord(item);
    if (!record) {
      dropped.push({ path, reason: "not an object" });
      return;
    }
    const claim = firstString(
      record,
      "claim",
      "text",
      "statement",
      "title",
      "content",
    );
    const evidence = parseEvidence(
      record["evidence"] ?? record["citations"],
      `${path}.evidence`,
      dropped,
    );
    const confidence = readUnitInterval(
      record["confidence"],
      `${path}.confidence`,
      schemaDefaults,
    );
    const parsed = CitedClaimSchema.safeParse({ claim, evidence, confidence });
    if (!parsed.success) {
      dropped.push({ path, reason: issueText(parsed.error) });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function parseEvidence(
  value: unknown,
  path: string,
  dropped: DroppedPlatformItem[],
): EvidenceReference[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    dropped.push({ path, reason: "evidence is not an array" });
    return [];
  }
  const kept: EvidenceReference[] = [];
  value.forEach((item, index) => {
    const normalized =
      typeof item === "string" && item.length > 0 ? { sourceId: item } : item;
    const parsed = EvidenceReferenceSchema.safeParse(normalized);
    if (!parsed.success) {
      dropped.push({
        path: `${path}[${index}]`,
        reason: issueText(parsed.error),
      });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function parseItems<T>(
  items: unknown[],
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      { success: true; data: T } | { success: false; error: SchemaIssueError };
  },
  pathPrefix: string,
  dropped: DroppedPlatformItem[],
): T[] {
  const kept: T[] = [];
  items.forEach((item, index) => {
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      dropped.push({
        path: `${pathPrefix}[${index}]`,
        reason: issueText(parsed.error),
      });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function readPolicyAssessment(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
  dropped: DroppedPlatformItem[],
): UnderwritingSubmission["policyAssessment"] {
  const value = record["policyAssessment"] ?? memo?.["policyAssessment"];
  if (value === undefined) {
    return { applicableRules: [], evaluations: [] };
  }
  const parsed = PolicyAssessmentSchema.safeParse(value);
  if (!parsed.success) {
    dropped.push({
      path: "policyAssessment",
      reason: issueText(parsed.error),
    });
    return { applicableRules: [], evaluations: [] };
  }
  return parsed.data;
}

function optionalRecommendationFields(
  recommendation: Record<string, unknown>,
  dropped: DroppedPlatformItem[],
): { proposedAmount?: unknown; proposedTermMonths?: unknown } {
  const extra: { proposedAmount?: unknown; proposedTermMonths?: unknown } = {};
  if (recommendation["proposedAmount"] !== undefined) {
    extra.proposedAmount = recommendation["proposedAmount"];
  }
  if (recommendation["proposedTermMonths"] !== undefined) {
    extra.proposedTermMonths = recommendation["proposedTermMonths"];
  }
  if (Object.keys(extra).length === 0) return {};
  const parsed = RecommendationSchema.safeParse({
    decision: "APPROVE",
    confidence: 0,
    conditions: [],
    policyExceptions: [],
    rationale: [],
    ...extra,
  });
  if (!parsed.success) {
    dropped.push({
      path: "recommendation",
      reason: issueText(parsed.error),
    });
    return {};
  }
  return {
    ...(parsed.data.proposedAmount
      ? { proposedAmount: parsed.data.proposedAmount }
      : {}),
    ...(parsed.data.proposedTermMonths
      ? { proposedTermMonths: parsed.data.proposedTermMonths }
      : {}),
  };
}

function readConfidence(
  record: Record<string, unknown>,
  schemaDefaults: DroppedPlatformItem[],
): UnderwritingSubmission["confidence"] {
  if (record["confidence"] === undefined) {
    schemaDefaults.push({
      path: "confidence",
      reason:
        "platform omitted confidence; set overall to 0 because the schema requires a number",
    });
    return { overall: 0, byComponent: {} };
  }
  const parsed = ConfidenceSchema.safeParse(record["confidence"]);
  if (!parsed.success) {
    schemaDefaults.push({
      path: "confidence",
      reason: `${issueText(parsed.error)}; set overall to 0`,
    });
    return { overall: 0, byComponent: {} };
  }
  return parsed.data;
}

function readUsage(
  record: Record<string, unknown>,
  dropped: DroppedPlatformItem[],
): { usage?: UnderwritingSubmission["usage"] } {
  if (record["usage"] === undefined) return {};
  const parsed = UsageSchema.safeParse(record["usage"]);
  if (!parsed.success) {
    dropped.push({ path: "usage", reason: issueText(parsed.error) });
    return {};
  }
  return { usage: parsed.data };
}

function readUnitInterval(
  value: unknown,
  path: string,
  schemaDefaults: DroppedPlatformItem[],
): number {
  if (typeof value === "number" && value >= 0 && value <= 1) return value;
  schemaDefaults.push({
    path,
    reason:
      value === undefined
        ? "platform omitted confidence; set to 0 because the schema requires a number"
        : "platform confidence is not in 0..1; set to 0",
  });
  return 0;
}

function memoMarkdown(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
): string {
  if (typeof record["body"] === "string") return record["body"];
  if (typeof record["markdown"] === "string") return record["markdown"];
  if (typeof record["memo"] === "string") return record["memo"];
  const nested = firstString(memo, "markdown", "body", "content");
  if (nested) return nested;
  const sections = memo?.["sections"] ?? record["sections"];
  if (Array.isArray(sections)) {
    return sections
      .map((section) => {
        const item = asRecord(section);
        const title = firstString(item, "title", "sectionType") ?? "";
        const content = firstString(item, "content", "markdown", "text") ?? "";
        return title ? `## ${title}\n\n${content}` : content;
      })
      .filter((part) => part.length > 0)
      .join("\n\n");
  }
  return "";
}

function parseJsonArray(value: string): unknown[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

interface SchemaIssueError {
  issues: { path: PropertyKey[]; message: string }[];
}

function issueText(error: SchemaIssueError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
