import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CasePackage, CasePolicyRule } from "./case-package.js";
import { isPlaceholderSpread } from "./submission-map.js";
import { mapPlatformDraft, platformRunArtifact } from "./platform-path.js";
import {
  mapPlatformPassthrough,
  MISSING_PLATFORM_SPREAD_NOTE,
} from "./platform-passthrough.js";
import { ToolClient } from "@uwbench/tool-runtime";

const here = dirname(fileURLToPath(import.meta.url));

const liquidityRule: CasePolicyRule = {
  ruleId: "rule_liquidity_minimum",
  sourceId: "src_policy_liquidity",
  title: "Minimum Liquidity Ratio",
  appliesWhen: "term loan requested",
  input: { ratio: "current_ratio" },
  operator: ">=",
  threshold: 1.2,
  onFailure: "CONDITION",
};

/**
 * Synthetic case package. Numbers are fixtures for the mapper, not a
 * published case. Current ratio 1.35 vs a 1.20 floor is the tight-liquidity
 * case the shaped mapper turns into APPROVE_WITH_CONDITIONS.
 */
function syntheticPackage(): CasePackage {
  const financialSpread = {
    revenue: { amount: 520_000_000, currency: "USD" as const },
    cogs: { amount: 286_000_000, currency: "USD" as const },
    ebitda: { amount: 104_000_000, currency: "USD" as const },
    interestExpense: { amount: 12_000_000, currency: "USD" as const },
    debtService: { amount: 38_000_000, currency: "USD" as const },
    totalDebt: { amount: 210_000_000, currency: "USD" as const },
    cash: { amount: 42_000_000, currency: "USD" as const },
    currentAssets: { amount: 135_000_000, currency: "USD" as const },
    currentLiabilities: { amount: 100_000_000, currency: "USD" as const },
    totalAssets: { amount: 480_000_000, currency: "USD" as const },
    totalLiabilities: { amount: 280_000_000, currency: "USD" as const },
    equity: { amount: 200_000_000, currency: "USD" as const },
    period: { start: "2024-01-01", end: "2024-12-31" },
    currency: "USD" as const,
    scale: "units" as const,
    signConvention: "all_positive" as const,
  };
  return {
    documents: [],
    records: [
      {
        recordId: "record_financials_2024",
        sourceId: "src_financials_2024",
        record: { financialSpread },
      },
    ],
    policies: [liquidityRule],
    client: new ToolClient({
      url: "http://127.0.0.1:1/v1/tools/call",
      bearerToken: "unused",
    }),
  };
}

const platformSpread = {
  revenue: { amount: 111, currency: "USD" as const },
  ebitda: { amount: 40, currency: "USD" as const },
  period: { start: "2024-01-01", end: "2024-12-31" },
  currency: "USD" as const,
  scale: "units" as const,
  signConvention: "all_positive" as const,
};

interface PlatformDraft {
  body: string;
  recommendation: {
    decision: string;
    confidence: number;
    conditions: {
      description: string;
      evidence: { sourceId: string }[];
    }[];
    policyExceptions: unknown[];
    rationale: {
      claim: string;
      evidence: { sourceId: string }[];
      confidence: number;
    }[];
  };
  financialSpread?: {
    revenue: { amount: number; currency: "USD" };
    ebitda: { amount: number; currency: "USD" };
    period: { start: string; end: string };
    currency: "USD";
    scale: "units";
    signConvention: "all_positive";
  };
  confidence: { overall: number; byComponent: { memo: number } };
  risks: {
    riskId: string;
    category: string;
    severity: string;
    statement: string;
    evidence: unknown;
    confidence?: number;
  }[];
  normalizedFacts: unknown[];
  discrepancies: unknown[];
}

function platformDraft(): PlatformDraft {
  return {
    body: "Platform memo body. recommendation: DECLINE is only prose.",
    recommendation: {
      decision: "APPROVE",
      confidence: 0.55,
      conditions: [
        {
          description: "Platform condition only.",
          evidence: [{ sourceId: "platform_src_not_in_catalog" }],
        },
      ],
      policyExceptions: [],
      rationale: [
        {
          claim: "Platform rationale.",
          evidence: [{ sourceId: "platform_src_not_in_catalog" }],
          confidence: 0.55,
        },
      ],
    },
    financialSpread: platformSpread,
    confidence: { overall: 0.42, byComponent: { memo: 0.4 } },
    risks: [
      {
        riskId: "risk_platform_only",
        category: "CREDIT",
        severity: "HIGH",
        statement: "Platform risk stays.",
        evidence: [
          { sourceId: "platform_src_not_in_catalog" },
          { sourceId: "" },
        ],
        confidence: 0.5,
      },
      {
        riskId: "risk_bad_severity",
        category: "CREDIT",
        severity: "HUGE",
        statement: "This risk is not a schema severity.",
        evidence: [],
        confidence: 0.2,
      },
    ],
    normalizedFacts: [
      {
        canonicalKey: "revenue",
        value: 111,
        type: "currency",
        evidence: [{ sourceId: "platform_src_not_in_catalog" }],
        confidence: 0.9,
      },
      {
        canonicalKey: "borrower.legal_name",
        value: "Synthetic Borrower",
        type: "string",
        evidence: [],
      },
    ],
    discrepancies: [
      {
        type: "conflict",
        description: "Platform discrepancy only.",
        sourceA: "platform_src_a",
        sourceB: "platform_src_b",
        materiality: "MATERIAL",
        status: "OPEN",
      },
    ],
  };
}

describe("platform passthrough mapping", () => {
  it("does not import the case-package shapers", () => {
    const source = readFileSync(join(here, "platform-passthrough.ts"), "utf8");
    expect(source.includes("mapChatPathToSubmission")).toBe(false);
    expect(source.includes("spreadFromPackage")).toBe(false);
    expect(source.includes("liquidityState")).toBe(false);
    expect(source.includes("risksFromMemoAndPack")).toBe(false);
  });

  it("submits the platform decision, risks, evidence, and spread", () => {
    const pkg = syntheticPackage();
    const draft = platformDraft();
    const mapped = mapPlatformDraft(pkg, draft, "passthrough", {
      workspaceId: "case-synth",
      workspaceName: "ten_case_synth",
    });

    expect(mapped.metadata.adapterMode).toBe("passthrough");
    expect(mapped.decision).toBe("APPROVE");
    expect(mapped.submission.recommendation.decision).toBe("APPROVE");
    expect(
      mapped.submission.recommendation.conditions.map(
        (item) => item.description,
      ),
    ).toEqual(["Platform condition only."]);
    expect(
      JSON.stringify(mapped.submission.recommendation.conditions),
    ).not.toMatch(/current ratio/i);
    expect(mapped.submission.financialSpread.revenue.amount).toBe(111);
    expect(mapped.submission.financialSpread.revenue.amount).not.toBe(
      520_000_000,
    );
    expect(mapped.submission.risks.map((risk) => risk.riskId)).toEqual([
      "risk_platform_only",
    ]);
    expect(
      mapped.submission.risks[0]?.evidence.map((item) => item.sourceId),
    ).toEqual(["platform_src_not_in_catalog"]);
    expect(
      mapped.submission.normalizedFacts.map((fact) => fact.canonicalKey),
    ).toEqual(["revenue"]);
    expect(mapped.submission.normalizedFacts[0]?.evidence[0]?.sourceId).toBe(
      "platform_src_not_in_catalog",
    );
    expect(
      mapped.submission.discrepancies.map((item) => item.description),
    ).toEqual(["Platform discrepancy only."]);
    expect(mapped.submission.memo.markdown).toBe(draft.body);
    expect(mapped.submission.memo.claims).toEqual([]);
    expect(
      mapped.submission.recommendation.rationale[0]?.evidence[0]?.sourceId,
    ).toBe("platform_src_not_in_catalog");
    expect(mapped.submission.confidence.overall).toBe(0.42);
    expect(JSON.stringify(mapped.submission)).not.toMatch(
      /risk_primary_operating/,
    );
    expect(JSON.stringify(mapped.submission)).not.toMatch(/risk_liquidity/);
    expect(JSON.stringify(mapped.submission)).not.toMatch(
      /src_financials_2024/,
    );
    expect(JSON.stringify(mapped.submission)).not.toMatch(
      /src_policy_liquidity/,
    );

    if (mapped.metadata.adapterMode !== "passthrough") {
      throw new Error("expected passthrough metadata");
    }
    expect(mapped.metadata.financialSpread).toBe("platform");
    expect(mapped.metadata.dropped.map((item) => item.path)).toEqual([
      "risks[0].evidence[1]",
      "risks[1]",
      "normalizedFacts[1]",
    ]);
    expect(mapped.metadata.schemaDefaults).toEqual([]);
    expect(mapped.metadata.normalized).toEqual([]);
    expect(mapped.metadata.absent.map((item) => item.path)).toEqual([
      "followUpRequests",
      "policyAssessment",
    ]);

    const artifact = platformRunArtifact(
      "case-synth",
      mapped.submission,
      mapped.metadata,
    );
    expect(artifact.artifactId).toBe("case-synth-adapter-manifest");
    expect(artifact.contentType).toBe("application/json");
    expect(JSON.parse(artifact.content)).toMatchObject({
      adapterMode: "passthrough",
      financialSpread: "platform",
      memoMarkdown: draft.body,
    });
  });

  it("leaves a missing platform spread as the schema placeholder", () => {
    const { financialSpread: _spread, ...draft } = platformDraft();
    const mapped = mapPlatformPassthrough(draft, "case-synth");
    expect(isPlaceholderSpread(mapped.submission.financialSpread)).toBe(true);
    expect(mapped.submission.financialSpread.revenue.amount).toBe(0);
    expect(mapped.submission.financialSpread.currency).toBe("XXX");
    expect(mapped.metadata.financialSpread).toBe("missing");
    expect(mapped.metadata.financialSpreadNote).toBe(
      MISSING_PLATFORM_SPREAD_NOTE,
    );
    expect(
      mapped.metadata.dropped.some((item) => item.path === "financialSpread"),
    ).toBe(false);
    expect(mapped.submission.recommendation.decision).toBe("APPROVE");
  });

  it("does not repair a platform spread that fails the schema", () => {
    const draft = platformDraft();
    draft.financialSpread = {
      ...platformSpread,
      revenue: { amount: 1.5, currency: "USD" },
    };
    const mapped = mapPlatformPassthrough(draft);
    expect(isPlaceholderSpread(mapped.submission.financialSpread)).toBe(true);
    expect(mapped.metadata.financialSpread).toBe("missing");
    expect(mapped.metadata.dropped.map((item) => item.path)).toContain(
      "financialSpread",
    );
    expect(mapped.submission.financialSpread.revenue.amount).not.toBe(2);
    expect(mapped.submission.financialSpread.revenue.amount).not.toBe(
      520_000_000,
    );
  });

  it("keeps a string citation id and does not swap it for a catalog id", () => {
    const draft = platformDraft();
    draft.risks = [
      {
        riskId: "risk_platform_only",
        category: "CREDIT",
        severity: "HIGH",
        statement: "Platform risk stays.",
        evidence: ["platform_src_not_in_catalog"],
        confidence: 0.5,
      },
    ];
    const mapped = mapPlatformPassthrough(draft);
    expect(mapped.submission.risks[0]?.evidence).toEqual([
      { sourceId: "platform_src_not_in_catalog" },
    ]);
  });

  it("refuses a decision that is not one of the schema values", () => {
    expect(() =>
      mapPlatformPassthrough({
        body: "recommendation: APPROVE",
        recommendation: { decision: "MAYBE" },
      }),
    ).toThrow(/no bench decision/);
  });

  it("drops a present risk that omits confidence instead of inventing one", () => {
    const draft = platformDraft();
    draft.risks = [
      {
        riskId: "risk_platform_only",
        category: "CREDIT",
        severity: "LOW",
        statement: "Platform risk stays.",
        evidence: [{ sourceId: "platform_src_not_in_catalog" }],
      },
    ];
    const mapped = mapPlatformPassthrough(draft);
    expect(mapped.submission.risks).toEqual([]);
    expect(mapped.submission.recommendation.decision).toBe("APPROVE");
    expect(mapped.metadata.dropped.map((item) => item.path)).toContain(
      "risks[0]",
    );
    expect(mapped.metadata.schemaDefaults).toEqual([]);
  });

  it("drops null spread lines and maps factId only when sourceId is missing", () => {
    const mapped = mapPlatformPassthrough({
      body: "Null and factId fallback.",
      recommendation: { decision: "APPROVE", confidence: 0.5, rationale: [] },
      financialSpread: {
        revenue: { amount: 50, currency: "USD" },
        cogs: null,
        ebitda: null,
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
      normalizedFacts: [
        {
          canonicalKey: "revenue",
          value: 50,
          type: "currency",
          evidence: [{ factId: "fact_revenue", documentId: "doc_1" }],
          confidence: 0.4,
        },
        {
          canonicalKey: "keep_source",
          value: 1,
          type: "string",
          evidence: [{ sourceId: "src_keep", factId: "fact_other" }],
          confidence: 1,
        },
      ],
      confidence: { overall: 0.5, byComponent: {} },
    });
    expect(mapped.submission.recommendation.decision).toBe("APPROVE");
    expect(mapped.submission.financialSpread.revenue.amount).toBe(50);
    expect(mapped.submission.financialSpread.cogs).toBeUndefined();
    expect(mapped.submission.financialSpread.ebitda).toBeUndefined();
    expect(mapped.submission.financialSpread.signConvention).toBe(
      "all_positive",
    );
    expect(
      mapped.submission.normalizedFacts.map((fact) => fact.canonicalKey),
    ).toEqual(["revenue"]);
    expect(mapped.submission.normalizedFacts[0]?.evidence).toEqual([
      { sourceId: "fact_revenue", documentId: "doc_1" },
    ]);
    expect(JSON.stringify(mapped.submission)).not.toContain("fact_other");
    expect(JSON.stringify(mapped.submission)).not.toContain("src_keep");
    expect(mapped.metadata.normalized).toEqual([
      { path: "financialSpread.cogs", action: "drop-null" },
      { path: "financialSpread.ebitda", action: "drop-null" },
      {
        path: "normalizedFacts[0].evidence[0]",
        action: "map-factId-to-sourceId",
      },
    ]);
  });

  it("does not fill currency, period, or signConvention when the spread is invalid", () => {
    const mapped = mapPlatformPassthrough({
      body: "Invalid spread.",
      recommendation: { decision: "DECLINE", confidence: 0.2 },
      financialSpread: {
        revenue: { amount: 50, currency: "USD" },
        cogs: null,
        currency: null,
        period: null,
        scale: "units",
        signConvention: "standard",
      },
    });
    expect(mapped.submission.recommendation.decision).toBe("DECLINE");
    expect(isPlaceholderSpread(mapped.submission.financialSpread)).toBe(true);
    expect(mapped.submission.financialSpread.revenue.amount).toBe(0);
    expect(mapped.metadata.financialSpread).toBe("missing");
    expect(mapped.metadata.normalized.map((item) => item.action)).toEqual([
      "drop-null",
      "drop-null",
      "drop-null",
    ]);
    expect(mapped.metadata.dropped.map((item) => item.path)).toContain(
      "financialSpread",
    );
    expect(JSON.stringify(mapped.metadata.normalized)).not.toContain(
      "all_positive",
    );
    expect(JSON.stringify(mapped.metadata.normalized)).not.toContain(
      "standard",
    );
  });

  it("maps draft_memo_from_file structuredContent field for field", () => {
    const draft = {
      body: "Platform memo from draft_memo_from_file.",
      facts: [
        {
          canonicalKey: "job.citation",
          value: "do-not-use",
          type: "string",
          evidence: [{ sourceId: "job_citation_graph" }],
          confidence: 1,
        },
      ],
      recommendation: {
        decision: "REFER",
        confidence: 0.64,
        wording: "Refer on the platform memo.",
        rationale: [
          {
            claim: "Debt service is inside the stated limit.",
            confidence: 0.64,
            evidence: [{ sourceId: "src_rationale" }],
          },
        ],
        conditions: [
          {
            description: "Provide the trailing covenant certificate.",
            evidence: [{ sourceId: "src_condition" }],
          },
        ],
        openItems: [{ label: "Do not import this open item" }],
        source: "draft_memo_from_file",
      },
      financialSpread: {
        revenue: { amount: 250_000, currency: "USD" },
        ebitda: { amount: 40_000, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
      normalizedFacts: [
        {
          canonicalKey: "revenue",
          value: 250_000,
          type: "currency",
          currency: "USD",
          period: { start: "2024-01-01", end: "2024-12-31" },
          evidence: [{ sourceId: "src_fact" }],
        },
      ],
      risks: [
        {
          riskId: "risk_platform_leverage",
          category: "CREDIT",
          severity: "HIGH",
          statement: "Leverage is the platform finding.",
          confidence: 0.4,
          evidence: [{ sourceId: "src_risk" }],
        },
      ],
      confidence: { overall: 0.71, byComponent: { memo: 0.66 } },
      policyAssessment: {
        applicableRules: ["rule_dscr"],
        evaluations: [
          {
            ruleId: "rule_dscr",
            passed: false,
            input: 1.1,
            threshold: 1.25,
            operator: ">=",
          },
        ],
      },
      discrepancies: [],
      followUpRequests: [
        { requestId: "fu_tax", concept: "tax_returns", status: "PENDING" },
      ],
      evidence: [{ sourceId: "src_platform_evidence" }],
    };
    const mapped = mapPlatformPassthrough(draft, "case-memo");
    const submission = mapped.submission;
    expect(submission.recommendation.decision).toBe("REFER");
    expect(submission.recommendation.confidence).toBe(0.64);
    expect(submission.recommendation.rationale).toEqual([
      {
        claim: "Debt service is inside the stated limit.",
        confidence: 0.64,
        evidence: [
          { sourceId: "src_rationale" },
          { sourceId: "src_platform_evidence" },
        ],
      },
    ]);
    expect(submission.recommendation.conditions).toEqual([
      {
        description: "Provide the trailing covenant certificate.",
        evidence: [{ sourceId: "src_condition" }],
      },
    ]);
    expect(submission.financialSpread.revenue).toEqual({
      amount: 250_000,
      currency: "USD",
    });
    expect(submission.financialSpread.ebitda).toEqual({
      amount: 40_000,
      currency: "USD",
    });
    expect(submission.financialSpread.cogs).toBeUndefined();
    expect(submission.financialSpread.period).toEqual({
      start: "2024-01-01",
      end: "2024-12-31",
    });
    expect(submission.financialSpread.signConvention).toBe("all_positive");
    expect(submission.normalizedFacts).toEqual([
      {
        canonicalKey: "revenue",
        value: 250_000,
        type: "currency",
        currency: "USD",
        period: { start: "2024-01-01", end: "2024-12-31" },
        evidence: [{ sourceId: "src_fact" }],
      },
    ]);
    expect(submission.risks).toEqual([
      {
        riskId: "risk_platform_leverage",
        category: "CREDIT",
        severity: "HIGH",
        statement: "Leverage is the platform finding.",
        confidence: 0.4,
        evidence: [{ sourceId: "src_risk" }],
      },
    ]);
    expect(submission.confidence).toEqual({
      overall: 0.71,
      byComponent: { memo: 0.66 },
    });
    expect(submission.policyAssessment).toEqual(draft.policyAssessment);
    expect(submission.discrepancies).toEqual([]);
    expect(submission.followUpRequests).toEqual(draft.followUpRequests);
    expect(submission.memo.markdown).toBe(draft.body);
    expect(JSON.stringify(submission)).not.toContain("job_citation_graph");
    expect(JSON.stringify(submission)).not.toContain(
      "Do not import this open item",
    );
    expect(mapped.metadata.absent).toEqual([]);
    expect(mapped.metadata.schemaDefaults).toEqual([]);
    expect(mapped.metadata.dropped).toEqual([]);
    expect(mapped.metadata.normalized).toEqual([
      {
        path: "recommendation.rationale[0].evidence",
        action: "map-platform-evidence",
      },
    ]);
  });

  it("keeps income-statement lines when the platform uses snake_case names", () => {
    const mapped = mapPlatformPassthrough({
      body: "Spread lines.",
      recommendation: { decision: "APPROVE", confidence: 0.5, rationale: [] },
      confidence: { overall: 0.5, byComponent: {} },
      financialSpread: {
        revenue: { amount: 100, currency: "USD" },
        cogs: { amount: 40, currency: "USD" },
        gross_profit: { amount: 60, currency: "USD" },
        operating_expenses: { amount: 25, currency: "USD" },
        ebitda: { amount: 35, currency: "USD" },
        taxes: { amount: 5, currency: "USD" },
        net_income: { amount: 20, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
        not_a_spread_line: { amount: 1, currency: "USD" },
      },
    });
    expect(mapped.submission.financialSpread.cogs?.amount).toBe(40);
    expect(mapped.submission.financialSpread.grossProfit?.amount).toBe(60);
    expect(mapped.submission.financialSpread.operatingExpenses?.amount).toBe(
      25,
    );
    expect(mapped.submission.financialSpread.ebitda?.amount).toBe(35);
    expect(mapped.submission.financialSpread.taxes?.amount).toBe(5);
    expect(mapped.submission.financialSpread.netIncome?.amount).toBe(20);
    expect(mapped.metadata.financialSpread).toBe("platform");
    expect(mapped.metadata.normalized.map((item) => item.path).sort()).toEqual([
      "financialSpread.gross_profit",
      "financialSpread.net_income",
      "financialSpread.operating_expenses",
    ]);
    expect(mapped.metadata.dropped.map((item) => item.path)).toEqual([
      "financialSpread.not_a_spread_line",
    ]);
    expect(JSON.stringify(mapped.submission.financialSpread)).not.toContain(
      "gross_profit",
    );
  });

  it("omits one invalid spread line without dropping the others", () => {
    const mapped = mapPlatformPassthrough({
      body: "One bad line.",
      recommendation: { decision: "APPROVE", confidence: 0.5, rationale: [] },
      confidence: { overall: 0.5, byComponent: {} },
      financialSpread: {
        revenue: { amount: 100, currency: "USD" },
        cogs: { amount: 1.5, currency: "USD" },
        net_income: { amount: 20, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
    });
    expect(mapped.submission.financialSpread.cogs).toBeUndefined();
    expect(mapped.submission.financialSpread.netIncome?.amount).toBe(20);
    expect(mapped.submission.financialSpread.revenue.amount).toBe(100);
    expect(mapped.metadata.dropped.map((item) => item.path)).toContain(
      "financialSpread.cogs",
    );
  });

  it("shaped mode still applies the liquidity override and the case-package spread", () => {
    const pkg = syntheticPackage();
    const draft = platformDraft();
    const mapped = mapPlatformDraft(pkg, draft, "shaped", {
      workspaceId: "case-synth",
      workspaceName: "ten_case_synth",
    });
    expect(mapped.metadata).toEqual({ adapterMode: "shaped" });
    expect(mapped.decision).toBe("APPROVE");
    expect(mapped.submission.recommendation.decision).toBe(
      "APPROVE_WITH_CONDITIONS",
    );
    expect(
      mapped.submission.recommendation.conditions.some((item) =>
        /current ratio/i.test(item.description),
      ),
    ).toBe(true);
    expect(mapped.submission.financialSpread.revenue.amount).toBe(520_000_000);
    expect(
      mapped.submission.risks.some(
        (risk) => risk.riskId === "risk_platform_only",
      ),
    ).toBe(false);
    expect(
      mapped.submission.risks.some(
        (risk) => risk.riskId === "risk_primary_operating",
      ),
    ).toBe(true);
    const artifact = platformRunArtifact(
      "case-synth",
      mapped.submission,
      mapped.metadata,
    );
    expect(artifact.artifactId).toBe("case-synth-securelend-memo");
    expect(artifact.contentType).toBe("text/markdown");
    expect(artifact.content).toBe(mapped.submission.memo.markdown);
  });
});
