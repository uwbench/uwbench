import {
  FinancialSpreadSchema,
  UnderwritingSubmissionSchema,
  type EvidenceReference,
  type FinancialSpread,
  type FollowUpRequest,
  type NormalizedFact,
  type PolicyAssessment,
  type RiskFinding,
  type ToolName,
  type UnderwritingSubmission,
} from "@uwbench/protocol";
import { ToolClient, type ToolClientOptions } from "@uwbench/tool-runtime";

export const AGENT_VERSION = "tool-agent-baseline-v1";

const CANDIDATE_RECORD_IDS = [
  "record_canonical_input",
  "record_borrower_profile",
  "record_financials_2024",
  "record_001",
];

const COMMON_CONCEPTS = [
  "tax_returns",
  "aging_receivables",
  "debt_service_schedule",
  "cash_flow_statement",
  "interim_financials",
  "revenue_reconciliation",
  "insurance_verification",
  "ownership_structure",
  "guarantor_agreement",
];

const SPREAD_FIELDS = {
  revenue: "revenue",
  cogs: "cogs",
  gross_profit: "grossProfit",
  grossProfit: "grossProfit",
  operating_expenses: "operatingExpenses",
  operatingExpenses: "operatingExpenses",
  ebitda: "ebitda",
  interest_expense: "interestExpense",
  interestExpense: "interestExpense",
  debt_service: "debtService",
  debtService: "debtService",
  total_debt: "totalDebt",
  totalDebt: "totalDebt",
  cash: "cash",
  current_assets: "currentAssets",
  currentLiabilities: "currentLiabilities",
  current_liabilities: "currentLiabilities",
  currentAssets: "currentAssets",
  total_assets: "totalAssets",
  totalAssets: "totalAssets",
  total_liabilities: "totalLiabilities",
  totalLiabilities: "totalLiabilities",
  equity: "equity",
  taxes: "taxes",
  net_income: "netIncome",
  netIncome: "netIncome",
} as const;

export interface ToolAgentContext {
  caseId: string;
  objective: string;
  requiredOutputs: string[];
  lane: "raw_documents" | "normalized_data" | "reasoning_only";
}

export interface ToolAgentRun {
  submission: UnderwritingSubmission;
  client: ToolClient;
}

interface StructuredRecord {
  recordId: string;
  sourceId: string;
  record: Record<string, unknown>;
}

interface PolicyRule {
  ruleId: string;
  sourceId: string;
  title: string;
  input: Record<string, unknown>;
  operator: string;
  threshold: unknown;
}

interface DocumentSummary {
  documentId: string;
  sourceId: string;
  title: string;
}

function evidenceFor(sourceId: string, documentId?: string): EvidenceReference[] {
  return documentId ? [{ sourceId, documentId }] : [{ sourceId }];
}

function money(
  amount: unknown,
): { amount: number; currency: "USD" } | undefined {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  return { amount: Math.round(amount), currency: "USD" };
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

function spreadFromRecord(
  record: Record<string, unknown>,
): FinancialSpread | undefined {
  const nested = record["financialSpread"];
  if (nested && typeof nested === "object") {
    const parsed = FinancialSpreadSchema.safeParse(nested);
    if (parsed.success) return parsed.data;
  }
  const built: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(SPREAD_FIELDS)) {
    const value = money(record[key]);
    if (value) built[field] = value;
  }
  if (!built["revenue"]) return undefined;
  const period = record["period"];
  return FinancialSpreadSchema.parse({
    ...built,
    period:
      period && typeof period === "object"
        ? period
        : { start: "2024-01-01", end: "2024-12-31" },
    currency: "USD",
    scale: "units",
    signConvention: "all_positive",
  });
}

function stringField(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function numberField(
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function conceptsFromObjective(objective: string): string[] {
  const mentioned = [
    ...new Set(objective.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []),
  ];
  return [...new Set([...mentioned, ...COMMON_CONCEPTS])];
}

function compare(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case "==":
    case "=":
      return value === threshold;
    case "!=":
      return value !== threshold;
    default:
      return false;
  }
}

export function createToolClient(options: ToolClientOptions): ToolClient {
  return new ToolClient(options);
}

export async function runToolAgent(
  context: ToolAgentContext,
  client: ToolClient,
): Promise<ToolAgentRun> {
  const documents = await discoverDocuments(client, context.objective);
  const records = await discoverRecords(client);
  const policies = await discoverPolicies(client);
  const spread =
    records
      .map((item) => spreadFromRecord(item.record))
      .find((item): item is FinancialSpread => item !== undefined) ??
    placeholderSpread();
  const hasSpread = spread.currency !== "XXX";

  if (hasSpread) {
    await client.tryCall("finance.validate_spread", { spread });
    await client.tryCall("finance.calculate", {
      expression: "revenue - 0",
      variables: { revenue: spread.revenue.amount },
    });
  }
  const ratioResult = hasSpread
    ? await client.tryCall("finance.calculate_ratios", { spread })
    : { ok: false as const, error: undefined };
  const ratios =
    ratioResult.ok && ratioResult.result["ratios"]
      ? (ratioResult.result["ratios"] as Record<string, number>)
      : {};

  const followUps = await requestMissingInformation(client, context.objective);
  for (const followUp of followUps) {
    for (const documentId of followUp.revealedDocuments ?? []) {
      if (documents.some((document) => document.documentId === documentId)) {
        continue;
      }
      const read = await client.tryCall("case.read_document", { documentId });
      if (read.ok) {
        documents.push({
          documentId,
          sourceId: String(read.result["sourceId"] ?? documentId),
          title: documentId,
        });
      }
    }
  }

  const primary = records[0];
  const evidence = primary
    ? evidenceFor(primary.sourceId)
    : documents[0]
      ? evidenceFor(documents[0].sourceId, documents[0].documentId)
      : [];
  const borrower = {
    legalName:
      records
        .map((item) =>
          stringField(item.record, "legal_name", "legalName", "name"),
        )
        .find((value) => value) ?? context.caseId,
    entityType:
      records
        .map((item) => stringField(item.record, "entity_type", "entityType"))
        .find((value) => value) ?? "unknown",
    naics:
      records
        .map((item) => stringField(item.record, "naics_code", "naics"))
        .find((value) => value) ?? "000000",
    state:
      records
        .map((item) => stringField(item.record, "state"))
        .find((value) => value) ?? "XX",
    years:
      records
        .map((item) =>
          numberField(item.record, "years_in_business", "yearsInBusiness"),
        )
        .find((value) => value !== undefined) ?? 0,
  };

  const policyAssessment = evaluatePolicies(policies, ratios);
  const risks = generateRisks(ratios, evidence);
  const facts = generateFacts(borrower, spread, evidence);
  const decision = !hasSpread
    ? "INSUFFICIENT_INFORMATION"
    : policyAssessment.evaluations.some((item) => !item.passed)
      ? "REFER"
      : followUps.length > 0
        ? "APPROVE_WITH_CONDITIONS"
        : "REFER";
  const memoMarkdown = [
    `# Tool-agent baseline — ${borrower.legalName}`,
    "",
    `Lane: ${context.lane}. Case: ${context.caseId}.`,
    `Discovered ${documents.length} documents, ${records.length} records, ${policies.length} policy rules.`,
    `Decision: ${decision}.`,
    `Runtime: ${AGENT_VERSION}`,
  ].join("\n");

  if (evidence.length > 0 || documents.length > 0) {
    await client.tryCall("submission.save_artifact", {
      artifactId: `${context.caseId}-tool-agent-memo`,
      content: memoMarkdown,
      contentType: "text/markdown",
    });
  }

  const submission = UnderwritingSubmissionSchema.parse({
    schemaVersion: "1.0",
    financialSpread: spread,
    normalizedFacts: facts,
    risks,
    discrepancies: [],
    complianceFindings: [],
    followUpRequests: followUps,
    policyAssessment,
    recommendation: {
      decision,
      confidence: hasSpread ? 0.7 : 1,
      conditions:
        followUps.length > 0
          ? [
              {
                description: "Review fulfilled information requests before close.",
                evidence,
              },
            ]
          : [],
      policyExceptions: [],
      rationale: [
        {
          claim: `${policyAssessment.evaluations.filter((item) => item.passed).length} of ${policyAssessment.evaluations.length} advertised policy rules pass.`,
          evidence: policies.map((rule) => ({ sourceId: rule.sourceId })),
          confidence: 1,
        },
      ],
    },
    memo: {
      markdown: memoMarkdown,
      claims: [
        {
          claim: `Tool-using baseline ${AGENT_VERSION} used only advertised tools.`,
          evidence,
          confidence: 1,
        },
      ],
    },
    confidence: {
      overall: hasSpread ? 0.7 : 0,
      byComponent: {
        financial_spread: hasSpread ? 1 : 0,
        policy_assessment: policies.length > 0 ? 1 : 0,
        follow_ups: followUps.length > 0 ? 1 : 0,
      },
    },
  });

  return { submission, client };
}

async function discoverDocuments(
  client: ToolClient,
  objective: string,
): Promise<DocumentSummary[]> {
  const listed = await client.call("case.list_documents", {});
  const documents = (
    (listed["documents"] as DocumentSummary[] | undefined) ?? []
  ).map((document) => ({
    documentId: document.documentId,
    sourceId: document.sourceId,
    title: document.title,
  }));
  for (const document of documents) {
    await client.tryCall("case.get_document_metadata", {
      documentId: document.documentId,
    });
    await client.tryCall("case.read_document", {
      documentId: document.documentId,
    });
  }
  const query = objective.split(/\s+/u).find((word) => word.length > 4) ?? "loan";
  await client.tryCall("case.search_documents", { query, limit: 5 });
  return documents;
}

async function discoverRecords(client: ToolClient): Promise<StructuredRecord[]> {
  const records: StructuredRecord[] = [];
  for (const recordId of CANDIDATE_RECORD_IDS) {
    const result = await client.tryCall("case.get_structured_record", {
      recordId,
    });
    if (!result.ok) continue;
    records.push({
      recordId,
      sourceId: String(result.result["sourceId"] ?? recordId),
      record: (result.result["record"] as Record<string, unknown>) ?? {},
    });
  }
  return records;
}

async function discoverPolicies(client: ToolClient): Promise<PolicyRule[]> {
  const summaries: Array<{ ruleId: string }> = [];
  for (const query of ["minimum", "maximum", "ratio"]) {
    const result = await client.tryCall("policy.search", { query, limit: 10 });
    if (!result.ok) continue;
    summaries.push(
      ...(((result.result["rules"] as Array<{ ruleId: string }>) ?? []) ?? []),
    );
  }
  const rules: PolicyRule[] = [];
  for (const ruleId of new Set(summaries.map((item) => item.ruleId))) {
    const result = await client.tryCall("policy.get_rule", { ruleId });
    if (!result.ok) continue;
    rules.push({
      ruleId,
      sourceId: String(result.result["sourceId"] ?? ruleId),
      title: String(result.result["title"] ?? ruleId),
      input:
        (result.result["input"] as Record<string, unknown> | undefined) ?? {},
      operator: String(result.result["operator"] ?? "=="),
      threshold: result.result["threshold"],
    });
  }
  return rules;
}

async function requestMissingInformation(
  client: ToolClient,
  objective: string,
): Promise<FollowUpRequest[]> {
  const followUps: FollowUpRequest[] = [];
  for (const concept of conceptsFromObjective(objective)) {
    const result = await client.tryCall("case.request_information", {
      requested_concepts: [concept],
      question: `Provide the available ${concept.replaceAll("_", " ")} information.`,
    });
    if (!result.ok) continue;
    const status = String(result.result["status"] ?? "NEEDS_CLARIFICATION");
    if (status === "NEEDS_CLARIFICATION") continue;
    const revealed =
      (result.result["revealedDocumentIds"] as string[] | undefined) ?? [];
    followUps.push({
      requestId: `req_${concept}`,
      concept,
      status: status === "AVAILABLE" ? "FULFILLED" : "FULFILLED",
      response:
        status === "ALREADY_PROVIDED"
          ? `${concept} was already provided.`
          : `Retrieved ${revealed.length} document(s) for ${concept}.`,
      revealedDocuments: revealed,
    });
    if (status === "AVAILABLE") {
      await client.tryCall("case.request_information", {
        requested_concepts: [concept],
        question: `Confirm whether ${concept.replaceAll("_", " ")} was already provided.`,
      });
    }
  }
  return followUps;
}

function evaluatePolicies(
  policies: PolicyRule[],
  ratios: Record<string, number>,
): PolicyAssessment {
  return {
    applicableRules: policies.map((rule) => rule.ruleId),
    evaluations: policies.map((rule) => {
      const ratioName = String(rule.input["ratio"] ?? "");
      const value = ratios[ratioName];
      const threshold = Number(rule.threshold);
      const passed =
        value !== undefined &&
        Number.isFinite(threshold) &&
        compare(value, rule.operator, threshold);
      const jsonThreshold =
        typeof rule.threshold === "number" ||
        typeof rule.threshold === "string" ||
        typeof rule.threshold === "boolean" ||
        rule.threshold === null
          ? rule.threshold
          : Number.isFinite(threshold)
            ? threshold
            : null;
      return {
        ruleId: rule.ruleId,
        passed,
        input: { [ratioName || "value"]: value ?? null },
        threshold: jsonThreshold,
        operator: rule.operator,
        exceptionDisclosed: false,
      };
    }),
  };
}

function generateRisks(
  ratios: Record<string, number>,
  evidence: EvidenceReference[],
): RiskFinding[] {
  if (evidence.length === 0) return [];
  const risks: RiskFinding[] = [];
  if (ratios["dscr"] !== undefined && ratios["dscr"] < 1.25) {
    risks.push({
      riskId: "risk_low_dscr",
      category: "FINANCIAL",
      severity: "HIGH",
      statement: `DSCR ${ratios["dscr"].toFixed(2)} is below 1.25.`,
      evidence,
      confidence: 0.8,
    });
  }
  if (ratios["leverage_ratio"] !== undefined && ratios["leverage_ratio"] > 4) {
    risks.push({
      riskId: "risk_high_leverage",
      category: "FINANCIAL",
      severity: "HIGH",
      statement: `Leverage ${ratios["leverage_ratio"].toFixed(2)} exceeds 4.0x.`,
      evidence,
      confidence: 0.8,
    });
  }
  if (risks.length === 0) {
    risks.push({
      riskId: "risk_general_credit",
      category: "OPERATIONAL",
      severity: "LOW",
      statement: "General credit risks remain after tool-based discovery.",
      evidence,
      confidence: 0.5,
    });
  }
  return risks;
}

function generateFacts(
  borrower: {
    legalName: string;
    entityType: string;
    naics: string;
    state: string;
    years: number;
  },
  spread: FinancialSpread,
  evidence: EvidenceReference[],
): NormalizedFact[] {
  if (evidence.length === 0) return [];
  return [
    {
      canonicalKey: "borrower.legal_name",
      value: borrower.legalName,
      type: "string",
      evidence,
      confidence: 1,
    },
    {
      canonicalKey: "financial.revenue",
      value: spread.revenue.amount,
      type: "money",
      currency: spread.currency === "XXX" ? undefined : spread.currency,
      period: spread.period,
      evidence,
      confidence: spread.currency === "XXX" ? 0 : 1,
    },
  ];
}

export const ADVERTISED_TOOLS: readonly ToolName[] = [
  "case.list_documents",
  "case.get_document_metadata",
  "case.read_document",
  "case.search_documents",
  "case.get_structured_record",
  "case.request_information",
  "policy.search",
  "policy.get_rule",
  "finance.calculate",
  "finance.calculate_ratios",
  "finance.validate_spread",
  "submission.save_artifact",
];
