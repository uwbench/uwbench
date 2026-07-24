import { describe, expect, it } from "vitest";
import {
  CitedClaimSchema,
  ConditionSchema,
  FinancialSpreadSchema,
  Iso4217CurrencySchema,
  NormalizedFactSchema,
  RecommendationSchema,
  RiskFindingSchema,
} from "./submission.js";

describe("financial value schemas", () => {
  it("accepts signed expense and loss values in minor units", () => {
    expect(
      FinancialSpreadSchema.safeParse({
        revenue: { amount: 1_000_000, currency: "USD" },
        cogs: { amount: -600_000, currency: "USD" },
        ebitda: { amount: -50_000, currency: "USD" },
        period: { start: "2025-01-01", end: "2025-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "positive_revenue_negative_expense",
      }).success,
    ).toBe(true);
  });

  it("keeps naturally nonnegative recommendation amounts nonnegative", () => {
    expect(
      RecommendationSchema.safeParse({
        decision: "APPROVE",
        confidence: 0.9,
        proposedAmount: { amount: -1, currency: "USD" },
        conditions: [],
        policyExceptions: [],
        rationale: [],
      }).success,
    ).toBe(false);
  });

  it("accepts supported ISO 4217 codes and rejects arbitrary triples", () => {
    expect(Iso4217CurrencySchema.safeParse("USD").success).toBe(true);
    expect(Iso4217CurrencySchema.safeParse("XAU").success).toBe(true);
    expect(Iso4217CurrencySchema.safeParse("ZZZ").success).toBe(false);
  });

  it("keeps private evaluator annotations out of participant risks", () => {
    const risk = {
      riskId: "risk_1",
      category: "LIQUIDITY",
      severity: "HIGH",
      statement: "Operating cash flow is deteriorating.",
      evidence: [{ sourceId: "financials_2025", page: 8 }],
      confidence: 0.9,
    };
    expect(RiskFindingSchema.safeParse(risk).success).toBe(true);
    expect(
      RiskFindingSchema.safeParse({
        ...risk,
        weight: 4,
        requiredEvidence: ["private_reference"],
        acceptableConcepts: ["private_concept"],
      }).success,
    ).toBe(false);
  });

  it("uses one structured evidence reference across submission artifacts", () => {
    const evidence = [{ sourceId: "financials_2025", page: 8 }];
    expect(
      NormalizedFactSchema.safeParse({
        canonicalKey: "revenue",
        value: 1_000_000,
        type: "money",
        evidence,
      }).success,
    ).toBe(true);
    expect(
      CitedClaimSchema.safeParse({
        claim: "Revenue grew.",
        evidence,
        confidence: 0.9,
      }).success,
    ).toBe(true);
    expect(
      ConditionSchema.safeParse({
        description: "Provide monthly reporting.",
        evidence,
      }).success,
    ).toBe(true);
  });
});
