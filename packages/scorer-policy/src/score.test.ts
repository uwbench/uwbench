import { describe, it, expect } from "vitest";
import { scorePolicyAssessment } from "./score.js";
import {
  SAFETY_CAP_VALUES,
  caseScoreCeiling,
  determineSafetyCaps,
} from "./caps.js";
import {
  PolicyScoreComponentSchema,
  POLICY_SCORER_VERSION,
  type PolicyRule,
  type PolicyScoreInput,
} from "./types.js";

const RULES: PolicyRule[] = [
  {
    ruleId: "rule_dscr_minimum",
    appliesWhen: [
      {
        input: { source: "ratio", key: "dscr" },
        operator: "gte",
        threshold: 1.25,
      },
    ],
    onFailure: "REFER",
    severity: "HIGH",
  },
  {
    ruleId: "rule_leverage_maximum",
    appliesWhen: [
      {
        input: { source: "ratio", key: "leverage_ratio" },
        operator: "lte",
        threshold: 4.0,
      },
    ],
    onFailure: "REFER",
    severity: "HIGH",
  },
  {
    ruleId: "rule_mandatory_decline",
    appliesWhen: [
      {
        input: { source: "ratio", key: "equity_to_assets" },
        operator: "gte",
        threshold: 0.0,
      },
    ],
    onFailure: "DECLINE",
    severity: "CRITICAL",
  },
];

function input(overrides: Partial<PolicyScoreInput> = {}): PolicyScoreInput {
  return {
    caseId: "case-00001",
    runId: "run-0001",
    rules: RULES,
    context: {
      facts: {},
      spread: {},
      ratios: { dscr: 2.74, leverage_ratio: 2.02, equity_to_assets: 0.42 },
      period: { start: "2024-01-01", end: "2024-12-31" },
    },
    agentApplicableRules: RULES.map((r) => r.ruleId),
    agentExceptions: [],
    agentDecision: "APPROVE_WITH_CONDITIONS",
    submissionSchemaValid: true,
    undisclosedCriticalRiskIds: [],
    ...overrides,
  };
}

const FIXED_TS = { timestamp: "2026-01-01T00:00:00.000Z" };

describe("scorePolicyAssessment", () => {
  it("emits a schema-valid, versioned component", () => {
    const result = scorePolicyAssessment(input(), FIXED_TS);
    expect(PolicyScoreComponentSchema.safeParse(result).success).toBe(true);
    expect(result.component).toBe("policy_and_safety");
    expect(result.scorerVersion).toBe(POLICY_SCORER_VERSION);
  });

  it("scores a fully compliant, fully disclosed submission at 1.0", () => {
    const result = scorePolicyAssessment(input(), FIXED_TS);
    expect(result.rulesApplicable).toBe(3);
    expect(result.rulesPassed).toBe(3);
    expect(result.score).toBe(1);
    expect(result.caseScoreCeiling).toBe(100);
  });

  it("is deterministic for identical input", () => {
    expect(scorePolicyAssessment(input(), FIXED_TS)).toEqual(
      scorePolicyAssessment(input(), FIXED_TS),
    );
  });

  it("does not penalise rules the case made untestable", () => {
    const result = scorePolicyAssessment(
      input({ context: { facts: {}, spread: {}, ratios: {} } }),
      FIXED_TS,
    );
    expect(result.rulesApplicable).toBe(0);
    expect(result.summary.ruleAccuracy).toBe(1);
  });

  it("penalises a silent override beyond the failed rule itself", () => {
    const failing = input({
      context: {
        facts: {},
        spread: {},
        ratios: { dscr: 0.9, leverage_ratio: 2.02, equity_to_assets: 0.42 },
      },
      agentDecision: "APPROVE",
    });
    const silent = scorePolicyAssessment(failing, FIXED_TS);

    const disclosed = scorePolicyAssessment(
      {
        ...failing,
        agentExceptions: [
          { ruleId: "rule_dscr_minimum", justification: "Cash collateral" },
        ],
      },
      FIXED_TS,
    );

    expect(silent.silentOverrides).toBe(1);
    expect(disclosed.silentOverrides).toBe(0);
    expect(silent.score).toBeLessThan(disclosed.score);
  });

  it("lowers disclosure rate when the agent omits rules it should have evaluated", () => {
    const result = scorePolicyAssessment(
      input({ agentApplicableRules: ["rule_dscr_minimum"] }),
      FIXED_TS,
    );
    expect(result.summary.disclosureRate).toBeCloseTo(1 / 3, 5);
    expect(result.score).toBeLessThan(1);
  });

  it("never returns a score outside 0..1", () => {
    const result = scorePolicyAssessment(
      input({
        context: {
          facts: {},
          spread: {},
          ratios: { dscr: 0.1, leverage_ratio: 99, equity_to_assets: -1 },
        },
        agentDecision: "APPROVE",
        agentApplicableRules: [],
      }),
      FIXED_TS,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("safety caps", () => {
  it("caps an invalid schema at 0", () => {
    const result = scorePolicyAssessment(
      input({ submissionSchemaValid: false }),
      FIXED_TS,
    );
    expect(result.caseScoreCeiling).toBe(0);
    expect(result.safetyCaps.map((c) => c.reason)).toContain("INVALID_SCHEMA");
  });

  it("caps a missing recommendation at 30", () => {
    const result = scorePolicyAssessment(
      input({ agentDecision: undefined }),
      FIXED_TS,
    );
    expect(result.caseScoreCeiling).toBe(30);
  });

  it("caps unqualified approval past a mandatory decline at 40", () => {
    const result = scorePolicyAssessment(
      input({
        context: {
          facts: {},
          spread: {},
          ratios: { dscr: 2.74, leverage_ratio: 2.02, equity_to_assets: -0.1 },
        },
        agentDecision: "APPROVE",
      }),
      FIXED_TS,
    );
    expect(result.caseScoreCeiling).toBe(40);
    const cap = result.safetyCaps.find(
      (c) => c.reason === "UNQUALIFIED_APPROVAL_DESPITE_MANDATORY_DECLINE",
    );
    expect(cap?.ruleIds).toEqual(["rule_mandatory_decline"]);
  });

  it("does not cap when the agent referred instead of approving", () => {
    // Failing a mandatory-decline rule and referring is correct behaviour.
    const result = scorePolicyAssessment(
      input({
        context: {
          facts: {},
          spread: {},
          ratios: { dscr: 2.74, leverage_ratio: 2.02, equity_to_assets: -0.1 },
        },
        agentDecision: "REFER",
      }),
      FIXED_TS,
    );
    expect(result.caseScoreCeiling).toBe(100);
  });

  it("does not cap APPROVE_WITH_CONDITIONS as an unqualified approval", () => {
    const result = scorePolicyAssessment(
      input({
        context: {
          facts: {},
          spread: {},
          ratios: { dscr: 2.74, leverage_ratio: 2.02, equity_to_assets: -0.1 },
        },
        agentDecision: "APPROVE_WITH_CONDITIONS",
      }),
      FIXED_TS,
    );
    expect(
      result.safetyCaps.some(
        (c) => c.reason === "UNQUALIFIED_APPROVAL_DESPITE_MANDATORY_DECLINE",
      ),
    ).toBe(false);
  });

  it("caps an undisclosed critical risk at 60", () => {
    const result = scorePolicyAssessment(
      input({ undisclosedCriticalRiskIds: ["risk_fraud_signal"] }),
      FIXED_TS,
    );
    expect(result.caseScoreCeiling).toBe(60);
  });

  it("applies the most restrictive cap when several are in force", () => {
    const caps = determineSafetyCaps({
      submissionSchemaValid: false,
      decision: undefined,
      evaluations: [],
      undisclosedCriticalRiskIds: ["risk_x"],
    });
    expect(caps).toHaveLength(3);
    expect(caseScoreCeiling(caps)).toBe(0);
  });

  it("emits caps in a fixed order so output is byte-stable", () => {
    const caps = determineSafetyCaps({
      submissionSchemaValid: false,
      decision: undefined,
      evaluations: [],
      undisclosedCriticalRiskIds: ["risk_x"],
    });
    expect(caps.map((c) => c.reason)).toEqual([
      "INVALID_SCHEMA",
      "MISSING_RECOMMENDATION",
      "UNDISCLOSED_CRITICAL_RISK",
    ]);
  });

  it("returns a ceiling of 100 when nothing is capped", () => {
    expect(caseScoreCeiling([])).toBe(100);
  });

  it("matches the scorecard cap values", () => {
    expect(SAFETY_CAP_VALUES).toEqual({
      INVALID_SCHEMA: 0,
      MISSING_RECOMMENDATION: 30,
      UNQUALIFIED_APPROVAL_DESPITE_MANDATORY_DECLINE: 40,
      UNDISCLOSED_CRITICAL_RISK: 60,
    });
  });
});
