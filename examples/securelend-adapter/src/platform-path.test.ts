import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  platformDocumentFields,
  platformFacts,
  platformFactsRequestBody,
  platformPackBody,
  platformUploadFileName,
  tenantForCase,
} from "./platform-path.js";
import { mapPlatformPassthrough } from "./platform-passthrough.js";
import { ToolGateway } from "@uwbench/tool-runtime";
import type {
  CaseDocument,
  CasePolicyRule,
  CaseRecord,
} from "./case-package.js";

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
    expect(platformFacts({ records }, "reasoning_only")).toMatchObject({
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
    expect(pack.eligibility[0]).toMatchObject({
      field: "dscr",
      op: "gte",
      onFail: "decline",
      value: 1.25,
    });
    expect(pack.eligibility[1]).toMatchObject({
      field: "current_ratio",
      op: "gte",
      onFail: "refer",
      value: 1.2,
    });
    expect(pack.testCases[0]?.expect).toBe("allow_human");
    expect(pack.testCases[0]?.facts).toEqual({
      dscr: 1.25,
      current_ratio: 1.2,
    });
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
        record: {
          revenue: 2_200_000_000,
          ebitda: 88_000_000,
          debt_service: 85_000_000,
        },
      },
      {
        recordId: "record_financials_2023",
        sourceId: "src_financials_2023",
        record: {
          revenue: 2_450_000_000,
          ebitda: 245_000_000,
          debt_service: 78_000_000,
        },
      },
    ];
    expect(platformFacts({ records }, "reasoning_only")).toMatchObject({
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
    expect(mixed.eligibility.map((rule) => rule.id)).toEqual([
      "rule_dscr_minimum",
    ]);
    const onlyFlag = platformPackBody([flag]);
    expect(onlyFlag.eligibility).toEqual([]);
    expect(onlyFlag.testCases[0]?.expect).toBe("insufficient");
  });

  it("posts canonical income lines only on normalized_data and reasoning_only", () => {
    const records: CaseRecord[] = [
      {
        recordId: "record_canonical_input",
        sourceId: "normalized:canonical-input",
        record: {
          financialSpread: {
            revenue: { amount: 1_000 },
            cogs: { amount: 400 },
            grossProfit: { amount: 600 },
            operatingExpenses: { amount: 250 },
            taxes: { amount: 50 },
            netIncome: { amount: 200 },
            ebitda: { amount: 350 },
          },
        },
      },
    ];
    for (const lane of ["reasoning_only", "normalized_data"] as const) {
      expect(
        platformFactsRequestBody({ records, documents: [] }, lane),
      ).toMatchObject({
        revenue: 1_000,
        cogs: 400,
        gross_profit: 600,
        operating_expenses: 250,
        taxes: 50,
        net_income: 200,
        ebitda: 350,
      });
    }
  });

  it("raw_documents posts no canonical-input values even if that record is present", () => {
    const records: CaseRecord[] = [
      {
        recordId: "record_canonical_input",
        sourceId: "normalized:canonical-input",
        record: {
          financialSpread: {
            revenue: { amount: 1_000 },
            cogs: { amount: 400 },
            grossProfit: { amount: 600 },
            operatingExpenses: { amount: 250 },
            taxes: { amount: 50 },
            netIncome: { amount: 200 },
          },
        },
      },
      {
        recordId: "record_financials_2024",
        sourceId: "src_financials_2024",
        record: { revenue: 7, cogs: 3 },
      },
    ];
    const body = platformFactsRequestBody(
      { records, documents: [] },
      "raw_documents",
    );
    expect(body["revenue"]).toBe(7);
    expect(body["cogs"]).toBe(3);
    expect(body["gross_profit"]).toBeUndefined();
    expect(body["operating_expenses"]).toBeUndefined();
    expect(body["taxes"]).toBeUndefined();
    expect(body["net_income"]).toBeUndefined();
    expect(body["ebitda"]).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("1000");
    expect(JSON.stringify(body)).not.toContain("normalized:canonical-input");
  });

  it("an unknown lane posts no facts", () => {
    const records: CaseRecord[] = [
      {
        recordId: "record_canonical_input",
        sourceId: "normalized:canonical-input",
        record: {
          financialSpread: {
            revenue: { amount: 1_000 },
            cogs: { amount: 400 },
            netIncome: { amount: 200 },
          },
        },
      },
      {
        recordId: "record_financials_2024",
        sourceId: "src_financials_2024",
        record: { revenue: 7 },
      },
    ];
    for (const lane of [undefined, "", "mystery"] as const) {
      const body = platformFactsRequestBody({ records, documents: [] }, lane);
      expect(body["revenue"]).toBeUndefined();
      expect(body["cogs"]).toBeUndefined();
      expect(body["net_income"]).toBeUndefined();
      expect(body["citations"]).toEqual({});
    }
  });

  it("posts public src and doc ids, currency, and statement period", () => {
    const records: CaseRecord[] = [
      {
        recordId: "record_canonical_input",
        sourceId: "normalized:canonical-input",
        record: {
          financialSpread: {
            revenue: { amount: 80 },
            currency: "USD",
            period: { start: "2024-01-01", end: "2024-12-31" },
          },
          normalizedFacts: [
            {
              canonicalKey: "revenue",
              value: 80,
              evidence: [
                {
                  sourceId: "src_tax_returns_2022_2024",
                  documentId: "doc_tax_returns_2022_2024",
                },
              ],
            },
          ],
        },
      },
    ];
    const documents: CaseDocument[] = [
      {
        documentId: "doc_tax_returns_2022_2024",
        sourceId: "src_tax_returns_2022_2024",
        title: "Tax returns",
        mimeType: "text/plain",
        fileName: "Tax returns 2022–2024.pdf",
        text: "revenue",
        bytes: Buffer.from("revenue"),
        uploadable: true,
      },
    ];
    const body = platformFactsRequestBody(
      { records, documents },
      "reasoning_only",
    );
    expect(body["revenue"]).toBe(80);
    expect(body["currency"]).toBe("USD");
    expect(body["period"]).toEqual({
      start: "2024-01-01",
      end: "2024-12-31",
    });
    expect(body["citations"]).toEqual({
      revenue: {
        sourceId: "src_tax_returns_2022_2024",
        documentId: "doc_tax_returns_2022_2024",
        currency: "USD",
        period: { start: "2024-01-01", end: "2024-12-31" },
      },
    });
    expect(JSON.stringify(body)).not.toContain("normalized:canonical-input");
    expect(platformDocumentFields(documents[0]!)).toEqual({
      sourceId: "src_tax_returns_2022_2024",
      documentId: "doc_tax_returns_2022_2024",
    });
    expect(platformUploadFileName(documents[0]!)).toBe(
      "doc_tax_returns_2022_2024.pdf",
    );
    expect(
      platformUploadFileName({
        documentId: "doc_tax_returns_2022_2024",
        mimeType: "text/plain",
        fileName: "cases/opaque_old/tax-returns.txt",
      }),
    ).toBe("doc_tax_returns_2022_2024.txt");
  });

  it("keeps a platform citation of those public ids reachable", async () => {
    const sourceId = "src_tax_returns_2022_2024";
    const documentId = "doc_tax_returns_2022_2024";
    const mapped = mapPlatformPassthrough({
      body: "Platform echoed the posted ids.",
      recommendation: {
        decision: "REFER",
        confidence: 0.4,
        rationale: [
          {
            claim: "Tax returns are on file.",
            confidence: 0.4,
            evidence: [{ sourceId, documentId }],
          },
        ],
      },
      financialSpread: {
        revenue: { amount: 80, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
      confidence: { overall: 0.4, byComponent: {} },
    });
    expect(mapped.submission.recommendation.rationale[0]?.evidence).toEqual([
      { sourceId, documentId },
    ]);
    const uploadPath = `cases/opaque_abc/${documentId}.txt`;
    const untouched = mapPlatformPassthrough({
      body: "Path citation stays a path.",
      recommendation: {
        decision: "REFER",
        confidence: 0.4,
        rationale: [
          {
            claim: "Cited by upload path.",
            confidence: 0.4,
            evidence: [{ sourceId: uploadPath }],
          },
        ],
      },
      confidence: { overall: 0.4, byComponent: {} },
    });
    expect(untouched.submission.recommendation.rationale[0]?.evidence).toEqual([
      { sourceId: uploadPath },
    ]);

    const gateway = new ToolGateway({
      port: 0,
      runToken: "synthetic-reachability",
      fixtures: {
        documents: [
          {
            documentId,
            sourceId,
            title: "Tax returns",
            mimeType: "text/plain",
            pageCount: 1,
            sizeBytes: 7,
            sha256: "ab".repeat(32),
            content: "revenue",
            pages: [{ pageNumber: 1, text: "revenue" }],
          },
        ],
        revealableDocuments: [],
        records: [],
        policies: [],
        information: {},
      },
    });
    expect(
      gateway.validateSubmissionEvidence(
        "synthetic-reachability",
        mapped.submission,
      ),
    ).toEqual([]);
  });
});
