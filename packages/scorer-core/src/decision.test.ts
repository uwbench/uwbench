import { describe, expect, it } from "vitest";
import {
  calculateBrierScore,
  calculateExpectedCalibrationError,
  confidenceDistribution,
  scoreDecision,
  type CreditDecision,
  type ParsedDecisionScoreInput,
} from "./decision.js";

const utility = {
  APPROVE: 0.2,
  APPROVE_WITH_CONDITIONS: 0.85,
  REFER: 1,
  DECLINE: 0.4,
  INSUFFICIENT_INFORMATION: 0.7,
} as const;

function input(
  decision: CreditDecision,
  confidence = 0.8,
): ParsedDecisionScoreInput {
  return {
    caseId: "case-1",
    runId: `run-${decision}`,
    recommendation: {
      decision,
      confidence,
      proposedAmount: { amount: 1_000_000, currency: "USD" },
      proposedTermMonths: 60,
      conditions: [{ description: "Key person insurance" }],
      policyExceptions: [],
    },
    utilityMatrix: {
      matrixVersion: "1.0",
      expectedDistribution: {
        APPROVE: 0,
        APPROVE_WITH_CONDITIONS: 0.35,
        REFER: 0.65,
        DECLINE: 0,
        INSUFFICIENT_INFORMATION: 0,
      },
      utility,
    },
    reference: {
      amount: {
        amount: 1_000_000,
        currency: "USD",
        absoluteTolerance: 0,
        relativeTolerance: 0,
      },
      termMonths: { value: 60, tolerance: 0 },
      requiredConditions: ["key person insurance"],
      expectedExceptionRuleIds: [],
      consistencyChecks: [true, true],
    },
    weights: {
      decision: 0.4,
      amount: 0.15,
      term: 0.1,
      conditions: 0.15,
      exceptions: 0.1,
      consistency: 0.1,
    },
  };
}

describe("decision and calibration scorer", () => {
  it.each([
    ["APPROVE", 0.2],
    ["REFER", 1],
    ["DECLINE", 0.4],
    ["INSUFFICIENT_INFORMATION", 0.7],
  ] as const)(
    "scores %s from the versioned utility matrix",
    (decision, expected) => {
      const result = scoreDecision(input(decision), {
        timestamp: "2026-08-13T00:00:00.000Z",
      });
      expect(result.dimensionScores.decision).toBe(expected);
      expect(result.matrixVersion).toBe("1.0");
      expect(result.scoredAt).toBe("2026-08-13T00:00:00.000Z");
    },
  );

  it("scores amount, term, conditions, exceptions, and consistency independently", () => {
    const value = input("REFER");
    value.recommendation.proposedAmount!.amount = 900_000;
    value.recommendation.proposedTermMonths = 48;
    value.recommendation.conditions = [];
    value.recommendation.policyExceptions = [
      { ruleId: "rule-extra", justification: "test" },
    ];
    value.reference.expectedExceptionRuleIds = ["rule-required"];
    value.reference.consistencyChecks = [true, false];

    expect(scoreDecision(value).dimensionScores).toEqual({
      decision: 1,
      amount: 0,
      term: 0,
      conditions: 0,
      exceptions: 0,
      consistency: 0.5,
    });
  });

  it("computes a multiclass Brier score from complete distributions", () => {
    const predicted = confidenceDistribution("REFER", 0.8);
    const expected = input("REFER").utilityMatrix.expectedDistribution;
    expect(calculateBrierScore(predicted, expected)).toBeCloseTo(0.12, 10);
    expect(scoreDecision(input("REFER")).brierScore).toBeCloseTo(0.12, 10);
  });

  it("computes weighted expected calibration error across non-empty bins", () => {
    const result = calculateExpectedCalibrationError(
      [
        { confidence: 0.9, outcome: 1 },
        { confidence: 0.8, outcome: 1 },
        { confidence: 0.6, outcome: 0 },
        { confidence: 0.4, outcome: 0 },
      ],
      5,
    );
    expect(result.expectedCalibrationError).toBeCloseTo(0.325, 10);
    expect(result.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(4);
  });

  it("rejects a utility distribution that does not sum to one", () => {
    const value = input("REFER");
    value.utilityMatrix.expectedDistribution.REFER = 0.5;
    expect(() => scoreDecision(value)).toThrow(/sum to 1/);
  });
});
