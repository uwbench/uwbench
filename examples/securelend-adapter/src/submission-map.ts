import {
  FinancialSpreadSchema,
  UnderwritingSubmissionSchema,
  type EvidenceReference,
  type FinancialSpread,
  type NormalizedFact,
  type RiskFinding,
  type UnderwritingSubmission,
} from "@uwbench/protocol";
import { asRecord, firstString } from "./mcp-client.js";
import type { CasePackage } from "./case-package.js";

const DECISIONS = [
  "APPROVE",
  "APPROVE_WITH_CONDITIONS",
  "REFER",
  "DECLINE",
  "INSUFFICIENT_INFORMATION",
] as const;

export interface ChatPathOutputs {
  workspaceId: string;
  workspaceName: string;
  extraction?: unknown;
  intelligence?: unknown;
  spread?: unknown;
  memo?: unknown;
}

export function mapChatPathToSubmission(
  pkg: CasePackage,
  outputs: ChatPathOutputs,
): UnderwritingSubmission {
  const evidence = evidenceFromPackage(pkg);
  const extraction = asRecord(outputs.extraction) ?? {};
  const spreadSource =
    asRecord(outputs.spread) ??
    asRecord(extraction["financialSpread"]) ??
    asRecord(extraction["spread"]) ??
    extraction;
  const spread = spreadFromUnknown(spreadSource) ?? placeholderSpread();
  const memoMarkdown = memoMarkdownFromUnknown(outputs.memo, outputs);
  const decision = decisionFromUnknown(outputs.memo, extraction);
  const facts = factsFromUnknown(extraction, evidence, pkg);
  const risks = risksFromUnknown(outputs, evidence);
  const parsed = UnderwritingSubmissionSchema.safeParse({
    schemaVersion: "1.0",
    financialSpread: spread,
    normalizedFacts: facts,
    risks,
    discrepancies: [],
    complianceFindings: [],
    followUpRequests: [],
    policyAssessment: { applicableRules: [], evaluations: [] },
    recommendation: {
      decision,
      confidence: spread.currency === "XXX" ? 0 : 0.6,
      conditions: [],
      policyExceptions: [],
      rationale: memoMarkdown
        ? [
            {
              claim:
                "SecureLend product chat path produced a professional memo.",
              evidence,
              confidence: 0.6,
            },
          ]
        : [],
    },
    memo: {
      markdown:
        memoMarkdown ||
        `# SecureLend UWBench run\n\nWorkspace ${outputs.workspaceName}.`,
      claims: evidence.length
        ? [
            {
              claim: `Mapped from SecureLend workspace ${outputs.workspaceId}.`,
              evidence,
              confidence: 0.5,
            },
          ]
        : [],
    },
    confidence: {
      overall: spread.currency === "XXX" ? 0 : 0.6,
      byComponent: {
        financial_spread: spread.currency === "XXX" ? 0 : 0.6,
        memo: memoMarkdown ? 0.7 : 0,
      },
    },
  });
  if (parsed.success) return parsed.data;
  return UnderwritingSubmissionSchema.parse(
    fallbackSubmission(outputs, evidence),
  );
}

function evidenceFromPackage(pkg: CasePackage): EvidenceReference[] {
  const fromDocs = pkg.documents.map((document) => ({
    sourceId: document.sourceId,
    documentId: document.documentId,
  }));
  if (fromDocs.length > 0) return fromDocs;
  return pkg.records.map((record) => ({ sourceId: record.sourceId }));
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

function spreadFromUnknown(value: unknown): FinancialSpread | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const nested =
    asRecord(record["financialSpread"]) ?? asRecord(record["spread"]) ?? record;
  const parsed = FinancialSpreadSchema.safeParse(nested);
  if (parsed.success) return parsed.data;
  const revenue = moneyField(
    nested["revenue"] ?? nested["Revenue"] ?? nested["totalRevenue"],
  );
  if (!revenue) return undefined;
  const built: Record<string, unknown> = {
    revenue,
    period: periodFromUnknown(nested["period"]) ?? {
      start: "2024-01-01",
      end: "2024-12-31",
    },
    currency: revenue.currency,
    scale: "units",
    signConvention: "all_positive",
  };
  const optional: Array<[string, unknown]> = [
    ["cogs", nested["cogs"] ?? nested["COGS"]],
    ["ebitda", nested["ebitda"] ?? nested["EBITDA"]],
    [
      "interestExpense",
      nested["interestExpense"] ?? nested["interest_expense"],
    ],
    ["debtService", nested["debtService"] ?? nested["debt_service"]],
    ["totalDebt", nested["totalDebt"] ?? nested["total_debt"]],
    ["cash", nested["cash"]],
    ["currentAssets", nested["currentAssets"] ?? nested["current_assets"]],
    [
      "currentLiabilities",
      nested["currentLiabilities"] ?? nested["current_liabilities"],
    ],
    ["totalAssets", nested["totalAssets"] ?? nested["total_assets"]],
    ["equity", nested["equity"]],
    ["netIncome", nested["netIncome"] ?? nested["net_income"]],
  ];
  for (const [field, raw] of optional) {
    const money = moneyField(raw);
    if (money) built[field] = money;
  }
  const second = FinancialSpreadSchema.safeParse(built);
  return second.success ? second.data : undefined;
}

function moneyField(
  value: unknown,
): { amount: number; currency: "USD" } | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { amount: Math.round(value), currency: "USD" };
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const amount = record["amount"];
  if (typeof amount === "number" && Number.isFinite(amount)) {
    const currency = firstString(record, "currency") === "USD" ? "USD" : "USD";
    return { amount: Math.round(amount), currency };
  }
  return undefined;
}

function periodFromUnknown(
  value: unknown,
): { start: string; end: string } | undefined {
  const record = asRecord(value);
  const start = firstString(record, "start");
  const end = firstString(record, "end");
  if (start && end) return { start, end };
  return undefined;
}

function memoMarkdownFromUnknown(
  memo: unknown,
  outputs: ChatPathOutputs,
): string {
  const record = asRecord(memo);
  if (typeof memo === "string" && memo.trim().length > 0) return memo;
  const direct =
    firstString(record, "markdown", "content", "memo") ??
    firstString(asRecord(record?.["memo"]), "markdown", "content");
  if (direct) return direct;
  const sections = record?.["sections"];
  if (Array.isArray(sections)) {
    const joined = sections
      .map((section) => {
        const item = asRecord(section);
        const title = firstString(item, "title", "sectionType") ?? "";
        const content = firstString(item, "content", "markdown", "text") ?? "";
        return title ? `## ${title}\n\n${content}` : content;
      })
      .filter((part) => part.length > 0)
      .join("\n\n");
    if (joined) return joined;
  }
  return [
    `# SecureLend product chat path`,
    "",
    `Workspace: ${outputs.workspaceName} (${outputs.workspaceId}).`,
  ].join("\n");
}

function decisionFromUnknown(
  memo: unknown,
  extraction: Record<string, unknown>,
): (typeof DECISIONS)[number] {
  const blobs = [
    asRecord(memo),
    extraction,
    asRecord(extraction["recommendation"]),
  ];
  for (const record of blobs) {
    const raw = firstString(record, "decision", "recommendation");
    if (raw && (DECISIONS as readonly string[]).includes(raw)) {
      return raw as (typeof DECISIONS)[number];
    }
  }
  const text = JSON.stringify(memo ?? {});
  for (const decision of DECISIONS) {
    if (text.includes(decision)) return decision;
  }
  return "INSUFFICIENT_INFORMATION";
}

function factsFromUnknown(
  extraction: Record<string, unknown>,
  evidence: EvidenceReference[],
  pkg: CasePackage,
): NormalizedFact[] {
  if (evidence.length === 0) return [];
  const facts: NormalizedFact[] = [];
  const nested = Array.isArray(extraction["normalizedFacts"])
    ? extraction["normalizedFacts"]
    : Array.isArray(extraction["facts"])
      ? extraction["facts"]
      : [];
  for (const item of nested) {
    const record = asRecord(item);
    const canonicalKey = firstString(record, "canonicalKey", "key");
    if (!record || !canonicalKey) continue;
    facts.push({
      canonicalKey,
      value: jsonValue(record["value"]),
      type: firstString(record, "type") ?? "string",
      evidence,
    });
  }
  if (facts.length > 0) return facts;
  const borrower = pkg.records
    .map((item) => item.record["legal_name"] ?? item.record["legalName"])
    .find((value) => typeof value === "string");
  if (typeof borrower === "string") {
    facts.push({
      canonicalKey: "borrower.legal_name",
      value: borrower,
      type: "string",
      evidence,
      confidence: 1,
    });
  }
  return facts;
}

function risksFromUnknown(
  outputs: ChatPathOutputs,
  evidence: EvidenceReference[],
): RiskFinding[] {
  const sources = [outputs.intelligence, outputs.extraction, outputs.memo];
  for (const source of sources) {
    const record = asRecord(source);
    const risks = record?.["risks"] ?? record?.["riskFindings"];
    if (!Array.isArray(risks)) continue;
    const mapped: RiskFinding[] = [];
    for (const [index, item] of risks.entries()) {
      const risk = asRecord(item);
      const statement = firstString(risk, "statement", "description", "text");
      if (!statement) continue;
      mapped.push({
        riskId: firstString(risk, "riskId", "id") ?? `risk_${index + 1}`,
        category: firstString(risk, "category") ?? "FINANCIAL",
        severity: coerceSeverity(firstString(risk, "severity")),
        statement,
        evidence,
        confidence: 0.5,
      });
    }
    if (mapped.length > 0) return mapped;
  }
  return [];
}

function jsonValue(value: unknown): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function coerceSeverity(value: string | undefined): RiskFinding["severity"] {
  const allowed = [
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
    "INFORMATIONAL",
  ] as const;
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as RiskFinding["severity"];
  }
  return "MEDIUM";
}

function fallbackSubmission(
  outputs: ChatPathOutputs,
  evidence: EvidenceReference[],
): UnderwritingSubmission {
  return {
    schemaVersion: "1.0",
    financialSpread: placeholderSpread(),
    normalizedFacts: [],
    risks: [],
    discrepancies: [],
    complianceFindings: [],
    followUpRequests: [],
    policyAssessment: { applicableRules: [], evaluations: [] },
    recommendation: {
      decision: "INSUFFICIENT_INFORMATION",
      confidence: 0,
      conditions: [],
      policyExceptions: [],
      rationale: [],
    },
    memo: {
      markdown: `SecureLend workspace ${outputs.workspaceName} (${outputs.workspaceId}).`,
      claims: evidence.length
        ? [
            {
              claim: "Run completed without a parseable structured memo.",
              evidence,
              confidence: 0,
            },
          ]
        : [],
    },
    confidence: { overall: 0, byComponent: {} },
  };
}
