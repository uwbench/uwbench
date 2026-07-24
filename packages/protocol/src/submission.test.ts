import { describe, expect, it } from "vitest";
import {
  FinancialSpreadSchema,
  Iso4217CurrencySchema,
  RecommendationSchema,
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
});
