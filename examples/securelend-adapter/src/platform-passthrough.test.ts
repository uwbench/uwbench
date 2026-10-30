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

  it("records a schema default when the platform omits risk confidence", () => {
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
    expect(mapped.submission.risks[0]?.confidence).toBe(0);
    expect(mapped.metadata.schemaDefaults).toEqual([
      {
        path: "risks[0].confidence",
        reason:
          "platform omitted confidence; set to 0 because the schema requires a number",
      },
    ]);
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
