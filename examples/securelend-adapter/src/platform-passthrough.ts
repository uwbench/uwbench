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
  "The platform draft did not include a financialSpread or spread that satisfies FinancialSpreadSchema. The submission uses the schema placeholder (currency XXX, period 1970-01-01, revenue 0). The case-package spread is not copied in. A spread that is present but fails the schema is treated the same way and listed in dropped. Null keys are removed before that check. currency, period, and signConvention are not filled in when the platform omits them or sends a value the schema rejects.";

export const PLATFORM_SPREAD_NOTE =
  "Platform financialSpread was submitted as returned. Case-package amounts were not merged in.";

export interface DroppedPlatformItem {
  path: string;
  reason: string;
}

/** Content-free schema normalization. No value is invented. */
export interface NormalizedPlatformField {
  path: string;
  action:
    | "drop-null"
    | "map-factId-to-sourceId"
    | "map-string-to-sourceId"
    | "map-platform-evidence"
    | "rename-spread-key";
}

export interface AbsentPlatformField {
  path: string;
}

export interface PlatformPassthroughMetadata {
  adapterMode: "passthrough";
  financialSpread: "platform" | "missing";
  financialSpreadNote: string;
  /** Schema rejects. Citation ids are not replaced with catalog ids. */
  dropped: DroppedPlatformItem[];
  /**
   * Schema-required numbers the platform omitted on the recommendation or
   * top-level confidence object. Recorded here instead of being filled in
   * silently. Decision is never defaulted. A present risk with no confidence
   * is kept at 0 because RiskFindingSchema requires the number. Claims are
   * not given a confidence.
   */
  schemaDefaults: DroppedPlatformItem[];
  /** Null drops and factId/evidence mappings. */
  normalized: NormalizedPlatformField[];
  /**
   * Listed platform sections that were missing or null. The submission keeps
   * the previous empty or zero fallback for those sections.
   */
  absent: AbsentPlatformField[];
}

interface PassContext {
  dropped: DroppedPlatformItem[];
  schemaDefaults: DroppedPlatformItem[];
  normalized: NormalizedPlatformField[];
  absent: AbsentPlatformField[];
}

export interface PlatformPassthroughResult {
  submission: UnderwritingSubmission;
  metadata: PlatformPassthroughMetadata;
}

const RISK_KEYS = [
  "risks",
  "reviewRisks",
  "review_risks",
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
  const ctx: PassContext = {
    dropped: [],
    schemaDefaults: [],
    normalized: [],
    absent: [],
  };
  const decision = readDecision(record, memo);
  if (!decision) {
    const suffix = caseId ? ` for ${caseId}` : "";
    throw new Error(`draft_memo_from_file returned no bench decision${suffix}`);
  }

  const spread = readSpread(record, memo, ctx);
  const recommendation =
    asRecord(record["recommendation"]) ??
    asRecord(memo?.["recommendation"]) ??
    {};
  const risks = parseRisks(riskItems(record, memo, ctx), ctx);
  // Only the memo's normalizedFacts. The underwrite job returns a different
  // citation graph; that payload is not an input to this mapper.
  const facts = parseFacts(
    readList(record, memo, ["normalizedFacts"], "normalizedFacts", ctx),
    ctx,
  );
  const platformEvidence = readPlatformEvidence(record, memo, ctx);
  const claims = [
    ...parseClaims(
      readList(record, memo, CLAIM_KEYS, "memo.claims", ctx),
      "memo.claims",
      ctx,
    ),
    ...platformEvidence.claims,
  ];
  const rationaleSection = sectionItems(
    recommendation,
    undefined,
    ["rationale"],
    "recommendation.rationale",
    ctx,
  );
  const rationale = parseClaims(
    rationaleSection,
    "recommendation.rationale",
    ctx,
  );
  const placed = placePlatformEvidence(
    claims,
    rationale,
    platformEvidence.refs,
    ctx,
  );

  const submission = UnderwritingSubmissionSchema.parse({
    schemaVersion: "1.0",
    financialSpread: spread.spread,
    normalizedFacts: facts,
    risks,
    discrepancies: parseItems(
      sectionItems(record, memo, ["discrepancies"], "discrepancies", ctx),
      DiscrepancySchema,
      "discrepancies",
      ctx,
    ),
    complianceFindings: parseItems(
      readList(record, memo, ["complianceFindings"], "complianceFindings", ctx),
      ComplianceFindingSchema,
      "complianceFindings",
      ctx,
    ),
    followUpRequests: parseItems(
      sectionItems(record, memo, ["followUpRequests"], "followUpRequests", ctx),
      FollowUpRequestSchema,
      "followUpRequests",
      ctx,
    ),
    policyAssessment: readPolicyAssessment(record, memo, ctx),
    recommendation: {
      decision,
      confidence: readUnitInterval(
        recommendation["confidence"],
        "recommendation.confidence",
        ctx,
      ),
      ...optionalRecommendationFields(recommendation, ctx),
      conditions: parseItems(
        arrayOrEmpty(
          recommendation["conditions"],
          "recommendation.conditions",
          ctx,
        ),
        ConditionSchema,
        "recommendation.conditions",
        ctx,
      ),
      policyExceptions: parseItems(
        arrayOrEmpty(
          recommendation["policyExceptions"],
          "recommendation.policyExceptions",
          ctx,
        ),
        PolicyExceptionSchema,
        "recommendation.policyExceptions",
        ctx,
      ),
      rationale: placed.rationale,
    },
    memo: {
      markdown: memoMarkdown(record, memo),
      claims: placed.claims,
    },
    confidence: readConfidence(record, memo, ctx),
    ...readUsage(record, ctx),
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
      dropped: ctx.dropped,
      schemaDefaults: ctx.schemaDefaults,
      normalized: ctx.normalized,
      absent: ctx.absent,
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
  ctx: PassContext,
): { spread: FinancialSpread; source: "platform" | "missing" } {
  const located = locateSpread(record, memo);
  if (!located) return { spread: placeholderSpread(), source: "missing" };
  // Null line items are absent. Known snake_case names are renamed onto the
  // UWBench spread fields. signConvention, currency, and period are not filled.
  const stripped = stripNulls(located.value, located.path, ctx.normalized);
  const prepared = preparePlatformSpread(stripped, located.path, ctx);
  const parsed = parseSpreadKeepingValidLines(prepared, located.path, ctx);
  if (parsed) return { spread: parsed, source: "platform" };
  return { spread: placeholderSpread(), source: "missing" };
}

const SPREAD_SCHEMA_KEYS = new Set([
  "revenue",
  "cogs",
  "grossProfit",
  "operatingExpenses",
  "ebitda",
  "interestExpense",
  "debtService",
  "totalDebt",
  "cash",
  "currentAssets",
  "currentLiabilities",
  "totalAssets",
  "totalLiabilities",
  "equity",
  "taxes",
  "netIncome",
  "period",
  "currency",
  "scale",
  "signConvention",
]);

const SPREAD_OPTIONAL_LINES = [
  "cogs",
  "grossProfit",
  "operatingExpenses",
  "ebitda",
  "interestExpense",
  "debtService",
  "totalDebt",
  "cash",
  "currentAssets",
  "currentLiabilities",
  "totalAssets",
  "totalLiabilities",
  "equity",
  "taxes",
  "netIncome",
] as const;

/** Platform fact names that are the same line as a UWBench spread field. */
const SPREAD_KEY_ALIASES: Record<string, string> = {
  cost_of_goods_sold: "cogs",
  costOfGoodsSold: "cogs",
  gross_profit: "grossProfit",
  operating_expenses: "operatingExpenses",
  interest_expense: "interestExpense",
  debt_service: "debtService",
  total_debt: "totalDebt",
  current_assets: "currentAssets",
  current_liabilities: "currentLiabilities",
  total_assets: "totalAssets",
  total_liabilities: "totalLiabilities",
  tax_expense: "taxes",
  taxExpense: "taxes",
  net_income: "netIncome",
};

function preparePlatformSpread(
  value: unknown,
  path: string,
  ctx: PassContext,
): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const next: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(record)) {
    const target = SPREAD_KEY_ALIASES[key] ?? key;
    if (target !== key) {
      ctx.normalized.push({
        path: `${path}.${key}`,
        action: "rename-spread-key",
      });
    }
    if (next[target] === undefined) {
      next[target] = raw;
      continue;
    }
    if (target !== key) {
      ctx.dropped.push({
        path: `${path}.${key}`,
        reason: `duplicate of ${target}; kept the schema-named line`,
      });
    }
  }
  for (const key of Object.keys(next)) {
    if (SPREAD_SCHEMA_KEYS.has(key)) continue;
    ctx.dropped.push({
      path: `${path}.${key}`,
      reason: "not a UWBench financialSpread field",
    });
    delete next[key];
  }
  return next;
}

function parseSpreadKeepingValidLines(
  value: unknown,
  path: string,
  ctx: PassContext,
): FinancialSpread | undefined {
  const first = FinancialSpreadSchema.safeParse(value);
  if (first.success) return first.data;
  const record = asRecord(value);
  if (!record) {
    ctx.dropped.push({ path, reason: issueText(first.error) });
    return undefined;
  }
  const failed = new Set<string>();
  for (const issue of first.error.issues) {
    const key = issue.path[0];
    if (
      typeof key === "string" &&
      (SPREAD_OPTIONAL_LINES as readonly string[]).includes(key)
    ) {
      failed.add(key);
    }
  }
  if (failed.size === 0) {
    ctx.dropped.push({ path, reason: issueText(first.error) });
    return undefined;
  }
  const next = { ...record };
  for (const key of failed) {
    ctx.dropped.push({
      path: `${path}.${key}`,
      reason: "spread line does not satisfy the schema and was omitted",
    });
    delete next[key];
  }
  const second = FinancialSpreadSchema.safeParse(next);
  if (second.success) return second.data;
  ctx.dropped.push({ path, reason: issueText(second.error) });
  return undefined;
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
  ctx: PassContext,
): unknown[] {
  const top = listAt(record, keys, path, ctx);
  if (top.found) return top.items;
  if (!nested) return [];
  const inner = listAt(nested, keys, `memo.${path}`, ctx);
  return inner.found ? inner.items : [];
}

/**
 * A listed platform section. Null is absent. A missing section is recorded
 * on `absent` and the caller keeps the previous empty fallback.
 */
function sectionItems(
  record: Record<string, unknown>,
  nested: Record<string, unknown> | undefined,
  keys: readonly string[],
  path: string,
  ctx: PassContext,
): unknown[] {
  const found = listAt(record, keys, path, ctx);
  if (found.found) return found.items;
  if (nested) {
    const inner = listAt(nested, keys, path, ctx);
    if (inner.found) return inner.items;
  }
  ctx.absent.push({ path });
  return [];
}

function listAt(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  ctx: PassContext,
): { found: boolean; items: unknown[] } {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value === null) {
      const nullPath = path === key || path.endsWith(`.${key}`) ? path : key;
      ctx.normalized.push({ path: nullPath, action: "drop-null" });
      continue;
    }
    if (Array.isArray(value)) return { found: true, items: value };
    if (typeof value === "string") {
      const parsed = parseJsonArray(value);
      if (parsed) return { found: true, items: parsed };
    }
    ctx.dropped.push({
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
  ctx: PassContext,
): unknown[] {
  if (value === undefined || value === null) {
    if (value === null) ctx.normalized.push({ path, action: "drop-null" });
    return [];
  }
  if (Array.isArray(value)) return value;
  ctx.dropped.push({ path, reason: "platform field is not an array" });
  return [];
}

/** Every present risk list, including reviewRisks. No count cap. */
function riskItems(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
  ctx: PassContext,
): unknown[] {
  const fromRecord = concatRiskLists(record, ctx);
  if (fromRecord.found) return fromRecord.items;
  if (memo) {
    const fromMemo = concatRiskLists(memo, ctx);
    if (fromMemo.found) return fromMemo.items;
  }
  ctx.absent.push({ path: "risks" });
  return [];
}

function concatRiskLists(
  source: Record<string, unknown>,
  ctx: PassContext,
): { found: boolean; items: unknown[] } {
  const items: unknown[] = [];
  let found = false;
  for (const key of RISK_KEYS) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value === null) {
      ctx.normalized.push({ path: key, action: "drop-null" });
      continue;
    }
    if (!Array.isArray(value)) {
      ctx.dropped.push({ path: key, reason: "platform field is not an array" });
      found = true;
      continue;
    }
    found = true;
    items.push(...value);
  }
  return { found, items };
}

function parseRisks(
  items: unknown[],
  ctx: PassContext,
): UnderwritingSubmission["risks"] {
  const kept: UnderwritingSubmission["risks"] = [];
  items.forEach((item, index) => {
    const path = `risks[${index}]`;
    const record = asRecord(item);
    if (!record) {
      ctx.dropped.push({ path, reason: "not an object" });
      return;
    }
    const stripped = stripNulls(record, path, ctx.normalized, true);
    const source = asRecord(stripped);
    if (!source) {
      ctx.dropped.push({ path, reason: "not an object" });
      return;
    }
    const candidate = schemaFields(source, [
      "riskId",
      "category",
      "severity",
      "statement",
    ]);
    if (typeof source["confidence"] === "number") {
      candidate["confidence"] = source["confidence"];
    } else {
      candidate["confidence"] = 0;
      ctx.schemaDefaults.push({
        path: `${path}.confidence`,
        reason:
          "platform omitted confidence; set to 0 because RiskFindingSchema requires a number",
      });
    }
    candidate["evidence"] = parseEvidence(
      Array.isArray(record["evidence"]) ? record["evidence"] : undefined,
      `${path}.evidence`,
      ctx,
    );
    const parsed = RiskFindingSchema.safeParse(candidate);
    if (!parsed.success) {
      ctx.dropped.push({ path, reason: issueText(parsed.error) });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function parseFacts(
  items: unknown[],
  ctx: PassContext,
): UnderwritingSubmission["normalizedFacts"] {
  const kept: UnderwritingSubmission["normalizedFacts"] = [];
  items.forEach((item, index) => {
    const path = `normalizedFacts[${index}]`;
    const record = asRecord(item);
    if (!record) {
      ctx.dropped.push({ path, reason: "not an object" });
      return;
    }
    const stripped = asRecord(stripNulls(record, path, ctx.normalized, true));
    if (!stripped) {
      ctx.dropped.push({ path, reason: "not an object" });
      return;
    }
    const evidence = parseEvidence(
      Array.isArray(record["evidence"]) ? record["evidence"] : undefined,
      `${path}.evidence`,
      ctx,
    );
    if (evidence.length === 0) {
      ctx.dropped.push({
        path,
        reason:
          "dropped because NormalizedFactSchema requires at least one evidence reference",
      });
      return;
    }
    const candidate = schemaFields(stripped, [
      "canonicalKey",
      "value",
      "normalizedValue",
      "type",
      "unit",
      "currency",
      "scale",
      "period",
      "confidence",
      "conflictGroup",
    ]);
    candidate["evidence"] = evidence;
    const parsed = NormalizedFactSchema.safeParse(candidate);
    if (!parsed.success) {
      ctx.dropped.push({ path, reason: issueText(parsed.error) });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function parseClaims(
  items: unknown[],
  pathPrefix: string,
  ctx: PassContext,
): CitedClaim[] {
  const kept: CitedClaim[] = [];
  items.forEach((item, index) => {
    const claim = parseClaimAt(item, `${pathPrefix}[${index}]`, ctx);
    if (claim) kept.push(claim);
  });
  return kept;
}

function parseClaimAt(
  item: unknown,
  path: string,
  ctx: PassContext,
): CitedClaim | undefined {
  const record = asRecord(item);
  if (!record) {
    ctx.dropped.push({ path, reason: "not an object" });
    return undefined;
  }
  const stripped = asRecord(stripNulls(record, path, ctx.normalized, true));
  if (!stripped) {
    ctx.dropped.push({ path, reason: "not an object" });
    return undefined;
  }
  const candidate = schemaFields(stripped, ["claim", "confidence"]);
  candidate["evidence"] = parseEvidence(
    Array.isArray(record["evidence"]) ? record["evidence"] : undefined,
    `${path}.evidence`,
    ctx,
  );
  const parsed = CitedClaimSchema.safeParse(candidate);
  if (!parsed.success) {
    ctx.dropped.push({ path, reason: issueText(parsed.error) });
    return undefined;
  }
  return parsed.data;
}

function readPlatformEvidence(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
  ctx: PassContext,
): { refs: { ref: EvidenceReference; path: string }[]; claims: CitedClaim[] } {
  const owned = ownedValue(record, memo, ["evidence"]);
  if (owned.state === "missing") return { refs: [], claims: [] };
  if (owned.state === "null") {
    ctx.normalized.push({ path: "evidence", action: "drop-null" });
    return { refs: [], claims: [] };
  }
  if (!Array.isArray(owned.value)) {
    ctx.dropped.push({
      path: "evidence",
      reason: "platform field is not an array",
    });
    return { refs: [], claims: [] };
  }
  const refs: { ref: EvidenceReference; path: string }[] = [];
  const claims: CitedClaim[] = [];
  owned.value.forEach((item, index) => {
    const path = `evidence[${index}]`;
    const recordItem = asRecord(item);
    if (recordItem && typeof recordItem["claim"] === "string") {
      const claim = parseClaimAt(item, path, ctx);
      if (claim) claims.push(claim);
      return;
    }
    const prepared = normalizeEvidenceRef(item, path, ctx);
    const parsed = EvidenceReferenceSchema.safeParse(prepared);
    if (!parsed.success) {
      ctx.dropped.push({ path, reason: issueText(parsed.error) });
      return;
    }
    refs.push({ ref: parsed.data, path });
  });
  return { refs, claims };
}

function placePlatformEvidence(
  claims: CitedClaim[],
  rationale: CitedClaim[],
  refs: { ref: EvidenceReference; path: string }[],
  ctx: PassContext,
): { claims: CitedClaim[]; rationale: CitedClaim[] } {
  if (refs.length === 0) return { claims, rationale };
  const evidence = refs.map((item) => item.ref);
  const memoEmpty = claims.findIndex((claim) => claim.evidence.length === 0);
  if (memoEmpty >= 0) {
    ctx.normalized.push({
      path: `memo.claims[${memoEmpty}].evidence`,
      action: "map-platform-evidence",
    });
    const next = claims.slice();
    next[memoEmpty] = { ...claims[memoEmpty]!, evidence };
    return { claims: next, rationale };
  }
  const rationaleEmpty = rationale.findIndex(
    (claim) => claim.evidence.length === 0,
  );
  if (rationaleEmpty >= 0) {
    ctx.normalized.push({
      path: `recommendation.rationale[${rationaleEmpty}].evidence`,
      action: "map-platform-evidence",
    });
    const next = rationale.slice();
    next[rationaleEmpty] = { ...rationale[rationaleEmpty]!, evidence };
    return { claims, rationale: next };
  }
  if (claims.length > 0) {
    ctx.normalized.push({
      path: "memo.claims[0].evidence",
      action: "map-platform-evidence",
    });
    const first = claims[0]!;
    return {
      claims: [
        { ...first, evidence: [...first.evidence, ...evidence] },
        ...claims.slice(1),
      ],
      rationale,
    };
  }
  if (rationale.length > 0) {
    ctx.normalized.push({
      path: "recommendation.rationale[0].evidence",
      action: "map-platform-evidence",
    });
    const first = rationale[0]!;
    return {
      claims,
      rationale: [
        { ...first, evidence: [...first.evidence, ...evidence] },
        ...rationale.slice(1),
      ],
    };
  }
  for (const item of refs) {
    ctx.dropped.push({
      path: item.path,
      reason:
        "schema-valid platform evidence has no submission evidence field to attach to",
    });
  }
  return { claims, rationale };
}

function parseEvidence(
  value: unknown,
  path: string,
  ctx: PassContext,
): EvidenceReference[] {
  if (value === undefined || value === null) {
    if (value === null) ctx.normalized.push({ path, action: "drop-null" });
    return [];
  }
  if (!Array.isArray(value)) {
    ctx.dropped.push({ path, reason: "evidence is not an array" });
    return [];
  }
  const kept: EvidenceReference[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const prepared = normalizeEvidenceRef(item, itemPath, ctx);
    const parsed = EvidenceReferenceSchema.safeParse(prepared);
    if (!parsed.success) {
      ctx.dropped.push({ path: itemPath, reason: issueText(parsed.error) });
      return;
    }
    kept.push(parsed.data);
  });
  return kept;
}

function normalizeEvidenceRef(
  item: unknown,
  path: string,
  ctx: PassContext,
): unknown {
  if (typeof item === "string" && item.length > 0) {
    ctx.normalized.push({ path, action: "map-string-to-sourceId" });
    return { sourceId: item };
  }
  const stripped = asRecord(stripNulls(item, path, ctx.normalized));
  if (!stripped) return item;
  const sourceId = stripped["sourceId"];
  const factId = stripped["factId"];
  const sourceMissing = typeof sourceId !== "string" || sourceId.length === 0;
  if (sourceMissing && typeof factId === "string" && factId.length > 0) {
    const next: Record<string, unknown> = { ...stripped, sourceId: factId };
    delete next["factId"];
    ctx.normalized.push({ path, action: "map-factId-to-sourceId" });
    return next;
  }
  return stripped;
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
  ctx: PassContext,
): T[] {
  const kept: T[] = [];
  items.forEach((item, index) => {
    const path = `${pathPrefix}[${index}]`;
    const prepared = prepareSchemaValue(item, path, ctx);
    const parsed = schema.safeParse(prepared);
    if (!parsed.success) {
      ctx.dropped.push({
        path,
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
  ctx: PassContext,
): UnderwritingSubmission["policyAssessment"] {
  const owned = ownedValue(record, memo, ["policyAssessment"]);
  if (owned.state === "null") {
    ctx.normalized.push({ path: "policyAssessment", action: "drop-null" });
  }
  if (owned.state !== "present") {
    ctx.absent.push({ path: "policyAssessment" });
    return { applicableRules: [], evaluations: [] };
  }
  const prepared = prepareSchemaValue(owned.value, "policyAssessment", ctx);
  const parsed = PolicyAssessmentSchema.safeParse(prepared);
  if (!parsed.success) {
    ctx.dropped.push({
      path: "policyAssessment",
      reason: issueText(parsed.error),
    });
    return { applicableRules: [], evaluations: [] };
  }
  return parsed.data;
}

function optionalRecommendationFields(
  recommendation: Record<string, unknown>,
  ctx: PassContext,
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
    ctx.dropped.push({
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
  memo: Record<string, unknown> | undefined,
  ctx: PassContext,
): UnderwritingSubmission["confidence"] {
  const owned = ownedValue(record, memo, ["confidence"]);
  if (owned.state === "null") {
    ctx.normalized.push({ path: "confidence", action: "drop-null" });
  }
  if (owned.state !== "present") {
    ctx.absent.push({ path: "confidence" });
    ctx.schemaDefaults.push({
      path: "confidence",
      reason:
        "platform omitted confidence; set overall to 0 because the schema requires a number",
    });
    return { overall: 0, byComponent: {} };
  }
  const prepared = prepareSchemaValue(owned.value, "confidence", ctx);
  const parsed = ConfidenceSchema.safeParse(prepared);
  if (!parsed.success) {
    ctx.schemaDefaults.push({
      path: "confidence",
      reason: `${issueText(parsed.error)}; set overall to 0`,
    });
    return { overall: 0, byComponent: {} };
  }
  return parsed.data;
}

function readUsage(
  record: Record<string, unknown>,
  ctx: PassContext,
): { usage?: UnderwritingSubmission["usage"] } {
  if (record["usage"] === undefined) return {};
  if (record["usage"] === null) {
    ctx.normalized.push({ path: "usage", action: "drop-null" });
    return {};
  }
  const prepared = prepareSchemaValue(record["usage"], "usage", ctx);
  const parsed = UsageSchema.safeParse(prepared);
  if (!parsed.success) {
    ctx.dropped.push({ path: "usage", reason: issueText(parsed.error) });
    return {};
  }
  return { usage: parsed.data };
}

function readUnitInterval(
  value: unknown,
  path: string,
  ctx: PassContext,
): number {
  if (typeof value === "number" && value >= 0 && value <= 1) return value;
  if (value === null) ctx.normalized.push({ path, action: "drop-null" });
  ctx.schemaDefaults.push({
    path,
    reason:
      value === undefined || value === null
        ? "platform omitted confidence; set to 0 because the schema requires a number"
        : "platform confidence is not in 0..1; set to 0",
  });
  return 0;
}

function ownedValue(
  record: Record<string, unknown>,
  memo: Record<string, unknown> | undefined,
  keys: readonly string[],
): { state: "missing" | "null" | "present"; value: unknown } {
  let sawNull = false;
  for (const source of [record, memo]) {
    if (!source) continue;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (source[key] === null) {
        sawNull = true;
        continue;
      }
      if (source[key] === undefined) continue;
      return { state: "present", value: source[key] };
    }
  }
  return { state: sawNull ? "null" : "missing", value: undefined };
}

function schemaFields(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return out;
}

function prepareSchemaValue(
  value: unknown,
  path: string,
  ctx: PassContext,
): unknown {
  const record = asRecord(value);
  if (!record) return stripNulls(value, path, ctx.normalized);
  const stripped = asRecord(stripNulls(record, path, ctx.normalized, true));
  if (!stripped) return value;
  if (Array.isArray(record["evidence"])) {
    stripped["evidence"] = parseEvidence(
      record["evidence"],
      `${path}.evidence`,
      ctx,
    );
  }
  return stripped;
}

function stripNulls(
  value: unknown,
  path: string,
  normalized: NormalizedPlatformField[],
  preserveEvidenceArray = false,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      stripNulls(item, `${path}[${index}]`, normalized),
    );
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const child = `${path}.${key}`;
    if (item === null) {
      normalized.push({ path: child, action: "drop-null" });
      continue;
    }
    if (preserveEvidenceArray && key === "evidence" && Array.isArray(item)) {
      out[key] = item;
      continue;
    }
    out[key] = stripNulls(item, child, normalized);
  }
  return out;
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
