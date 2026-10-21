import { UnderwritingSubmissionSchema } from "@uwbench/protocol";
import { describe, expect, it } from "vitest";
import { emptyTrace } from "./agent-core.js";
import {
  fabricatedWrapperSourceIds,
  policyBreachWithoutRisk,
  recordGap,
  selectHarnessId,
  specialistKeepsBase,
  unreturnedCitationSourceIds,
} from "./failure-signatures.js";

describe("failure signatures", () => {
  it("keeps the base when no discovery signature is present", () => {
    const submission = UnderwritingSubmissionSchema.parse({
      schemaVersion: "1.0",
      financialSpread: {
        revenue: { amount: 0, currency: "XXX" },
        period: { start: "1970-01-01", end: "1970-01-01" },
        currency: "XXX",
        scale: "units",
        signConvention: "all_positive",
      },
      normalizedFacts: [],
      risks: [],
      discrepancies: [],
      complianceFindings: [],
      followUpRequests: [],
      policyAssessment: { applicableRules: [], evaluations: [] },
      recommendation: {
        decision: "INSUFFICIENT_INFORMATION",
        confidence: 1,
        conditions: [],
        policyExceptions: [],
        rationale: [],
      },
      memo: { markdown: "none", claims: [] },
      confidence: { overall: 0, byComponent: {} },
    });
    expect(selectHarnessId(submission, emptyTrace())).toBe("base");
  });

  it("routes a canonical-wrapper citation to the citation specialist", () => {
    const submission = UnderwritingSubmissionSchema.parse({
      schemaVersion: "1.0",
      financialSpread: {
        revenue: { amount: 1, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
      normalizedFacts: [
        {
          canonicalKey: "financial.revenue",
          value: 1,
          type: "money",
          currency: "USD",
          evidence: [{ sourceId: "normalized:canonical-input" }],
          confidence: 1,
        },
      ],
      risks: [],
      discrepancies: [],
      complianceFindings: [],
      followUpRequests: [],
      policyAssessment: {
        applicableRules: ["rule_dscr_minimum"],
        evaluations: [
          {
            ruleId: "rule_dscr_minimum",
            passed: true,
            input: { dscr: 2 },
            threshold: 1.25,
            operator: ">=",
            exceptionDisclosed: false,
          },
        ],
      },
      recommendation: {
        decision: "REFER",
        confidence: 0.7,
        conditions: [],
        policyExceptions: [],
        rationale: [],
      },
      memo: { markdown: "memo", claims: [] },
      confidence: { overall: 0.7, byComponent: {} },
    });
    expect(fabricatedWrapperSourceIds(submission)).toEqual([
      "normalized:canonical-input",
    ]);
    expect(selectHarnessId(submission, emptyTrace())).toBe("citation-anchor");
    expect(
      specialistKeepsBase(submission, {
        ...emptyTrace(),
        policySourceIds: ["src_policy_dscr"],
      }),
    ).toBe(true);
  });

  it("prefers the record-gap specialist when the standard financial record is missing", () => {
    const submission = UnderwritingSubmissionSchema.parse({
      schemaVersion: "1.0",
      financialSpread: {
        revenue: { amount: 1, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
      normalizedFacts: [],
      risks: [],
      discrepancies: [],
      complianceFindings: [],
      followUpRequests: [],
      policyAssessment: { applicableRules: [], evaluations: [] },
      recommendation: {
        decision: "REFER",
        confidence: 0.7,
        conditions: [],
        policyExceptions: [],
        rationale: [],
      },
      memo: { markdown: "memo", claims: [] },
      confidence: { overall: 0.7, byComponent: {} },
    });
    const trace = {
      ...emptyTrace(),
      recordAttempts: [
        {
          recordId: "record_canonical_input",
          ok: true,
          sourceId: "normalized:canonical-input",
        },
        {
          recordId: "record_borrower_profile",
          ok: true,
          sourceId: "src_borrower_profile",
        },
        { recordId: "record_financials_2024", ok: false },
      ],
    };
    expect(recordGap(trace)).toBe(true);
    expect(selectHarnessId(submission, trace)).toBe("record-coverage");
  });

  it("routes an unmentioned failed ratio to the policy-risk specialist", () => {
    const submission = UnderwritingSubmissionSchema.parse({
      schemaVersion: "1.0",
      financialSpread: {
        revenue: { amount: 1, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
      normalizedFacts: [],
      risks: [
        {
          riskId: "risk_general_credit",
          category: "OPERATIONAL",
          severity: "LOW",
          statement: "General credit risks remain after tool-based discovery.",
          evidence: [{ sourceId: "src_financials_2024" }],
          confidence: 0.5,
        },
      ],
      discrepancies: [],
      complianceFindings: [],
      followUpRequests: [],
      policyAssessment: {
        applicableRules: ["rule_liquidity_minimum"],
        evaluations: [
          {
            ruleId: "rule_liquidity_minimum",
            passed: false,
            input: { current_ratio: 1.15 },
            threshold: 1.2,
            operator: ">=",
            exceptionDisclosed: false,
          },
        ],
      },
      recommendation: {
        decision: "REFER",
        confidence: 0.7,
        conditions: [],
        policyExceptions: [],
        rationale: [],
      },
      memo: { markdown: "memo", claims: [] },
      confidence: { overall: 0.7, byComponent: {} },
    });
    expect(policyBreachWithoutRisk(submission)).toBe(true);
    expect(selectHarnessId(submission, emptyTrace())).toBe(
      "policy-breach-risk",
    );
    expect(unreturnedCitationSourceIds(submission, emptyTrace())).toEqual([
      "src_financials_2024",
    ]);
  });
});
