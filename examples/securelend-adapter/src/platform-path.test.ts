import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { platformFacts, platformPackBody, tenantForCase } from "./platform-path.js";
import type { CasePolicyRule, CaseRecord } from "./case-package.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("desk score-gate profile", () => {
  it("does not call the old catalog or the filing tools", () => {
    const source = readFileSync(join(here, "platform-path.ts"), "utf8");
    for (const name of [
      "create_deal_workspace",
      "submit_documents",
      "run_document_intelligence",
      "run_data_extraction",
      "run_financial_statement_spread",
      "run_professional_memo",
      "get_memo_status",
      "resolve_listed_company",
      "read_listed_company",
    ]) {
      expect(source.includes(name)).toBe(false);
    }
    expect(source).toContain("draft_memo_from_file");
    expect(source).toContain('pipeline: "underwrite"');
  });

  it("maps a spread and a customer share onto bench fact names", () => {
    const records: CaseRecord[] = [
      {
        recordId: "record_canonical_input",
        sourceId: "normalized:canonical-input",
        record: {
          financialSpread: {
            revenue: { amount: 100 },
            ebitda: { amount: 40 },
            interestExpense: { amount: 5 },
            debtService: { amount: 20 },
            totalDebt: { amount: 80 },
            equity: { amount: 50 },
            totalAssets: { amount: 200 },
            currentAssets: { amount: 60 },
            currentLiabilities: { amount: 30 },
            totalLiabilities: { amount: 150 },
          },
        },
      },
      {
        recordId: "record_customer_concentration",
        sourceId: "src_customer_concentration",
        record: { top_1_pct: 0.32 },
      },
      {
        recordId: "record_collateral_appraisal",
        sourceId: "src_collateral_appraisal",
        record: { forced_liquidation_value: 520, requested_amount: 390 },
      },
    ];
    expect(platformFacts({ records })).toMatchObject({
      revenue: 100,
      ebitda: 40,
      interest_expense: 5,
      debt_service: 20,
      total_debt: 80,
      equity: 50,
      total_assets: 200,
      current_assets: 60,
      current_liabilities: 30,
      total_liabilities: 150,
      top_customer_revenue: 32,
      forced_liquidation_value: 520,
      requested_amount: 390,
    });
  });

  it("turns a condition failure into refer and builds a passing test case", () => {
    const policies: CasePolicyRule[] = [
      {
        ruleId: "rule_dscr_minimum",
        sourceId: "src_policy_dscr",
        title: "DSCR",
        appliesWhen: "term loan requested",
        input: { ratio: "dscr" },
        operator: ">=",
        threshold: 1.25,
        onFailure: "DECLINE",
      },
      {
        ruleId: "rule_liquidity_minimum",
        sourceId: "src_policy_liquidity",
        title: "Liquidity",
        appliesWhen: "term loan requested",
        input: { ratio: "current_ratio" },
        operator: ">=",
        threshold: 1.2,
        onFailure: "CONDITION",
      },
    ];
    const pack = platformPackBody(policies);
    expect(pack.eligibility[0]).toMatchObject({ field: "dscr", op: "gte", onFail: "decline", value: 1.25 });
    expect(pack.eligibility[1]).toMatchObject({ field: "current_ratio", op: "gte", onFail: "refer", value: 1.2 });
    expect(pack.testCases[0]?.expect).toBe("allow_human");
    expect(pack.testCases[0]?.facts).toEqual({ dscr: 1.25, current_ratio: 1.2 });
    expect(tenantForCase("case-00001")).toBe("ten_case_00001");
  });

  it("an empty policy list expects insufficient, not a made-up rule", () => {
    const pack = platformPackBody([]);
    expect(pack.eligibility).toEqual([]);
    expect(pack.testCases[0]?.expect).toBe("insufficient");
  });

  it("keeps the current-year amount when a later prior year repeats the field", () => {
    const records: CaseRecord[] = [
      {
        recordId: "record_canonical_input",
        sourceId: "normalized:canonical-input",
        record: {
          financialSpread: {
            revenue: { amount: 2_200_000_000 },
            ebitda: { amount: 88_000_000 },
          },
        },
      },
      {
        recordId: "record_financials_2024",
        sourceId: "src_financials_2024",
        record: { revenue: 2_200_000_000, ebitda: 88_000_000, debt_service: 85_000_000 },
      },
      {
        recordId: "record_financials_2023",
        sourceId: "src_financials_2023",
        record: { revenue: 2_450_000_000, ebitda: 245_000_000, debt_service: 78_000_000 },
      },
    ];
    expect(platformFacts({ records })).toMatchObject({
      revenue: 2_200_000_000,
      ebitda: 88_000_000,
      debt_service: 85_000_000,
    });
  });

  it("skips a term-loan rule that has no ratio input", () => {
    const flag: CasePolicyRule = {
      ruleId: "rule_exception_framework",
      sourceId: "src_policy_exception_framework",
      title: "Policy Exception Framework",
      appliesWhen: "term loan requested",
      input: { flag: "policy_exception_requested" },
      operator: "eq",
      threshold: true,
      onFailure: "REFER",
    };
    const ratio: CasePolicyRule = {
      ruleId: "rule_dscr_minimum",
      sourceId: "src_policy_dscr",
      title: "DSCR",
      appliesWhen: "term loan requested",
      input: { ratio: "dscr" },
      operator: ">=",
      threshold: 1.25,
      onFailure: "DECLINE",
    };
    const mixed = platformPackBody([flag, ratio]);
    expect(mixed.eligibility.map((rule) => rule.id)).toEqual(["rule_dscr_minimum"]);
    const onlyFlag = platformPackBody([flag]);
    expect(onlyFlag.eligibility).toEqual([]);
    expect(onlyFlag.testCases[0]?.expect).toBe("insufficient");
  });
});
