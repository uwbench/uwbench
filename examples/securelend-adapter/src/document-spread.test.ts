import { describe, expect, it } from "vitest";
import { ToolClient } from "@uwbench/tool-runtime";
import { mapChatPathToSubmission } from "./submission-map.js";
import type { CasePackage, CasePolicyRule } from "./case-package.js";

const PUBLIC_TERM_LOAN_RULES: CasePolicyRule[] = [
  {
    ruleId: "rule_dscr_minimum",
    sourceId: "src_policy_dscr",
    title: "Minimum Debt Service Coverage Ratio",
    appliesWhen: "term loan requested",
    input: { ratio: "dscr" },
    operator: ">=",
    threshold: 1.25,
    onFailure: "REFER",
  },
  {
    ruleId: "rule_leverage_maximum",
    sourceId: "src_policy_leverage",
    title: "Maximum Leverage Ratio",
    appliesWhen: "term loan requested",
    input: { ratio: "leverage_ratio" },
    operator: "<=",
    threshold: 4.0,
    onFailure: "REFER",
  },
  {
    ruleId: "rule_interest_coverage_minimum",
    sourceId: "src_policy_interest_coverage",
    title: "Minimum Interest Coverage Ratio",
    appliesWhen: "term loan requested",
    input: { ratio: "interest_coverage" },
    operator: ">=",
    threshold: 3.0,
    onFailure: "REFER",
  },
  {
    ruleId: "rule_liquidity_minimum",
    sourceId: "src_policy_liquidity",
    title: "Minimum Liquidity Ratio",
    appliesWhen: "term loan requested",
    input: { ratio: "current_ratio" },
    operator: ">=",
    threshold: 1.2,
    onFailure: "CONDITION",
  },
  {
    ruleId: "rule_equity_cushion_minimum",
    sourceId: "src_policy_equity_cushion",
    title: "Minimum Equity Cushion",
    appliesWhen: "term loan requested",
    input: { ratio: "equity_to_assets" },
    operator: ">=",
    threshold: 0.25,
    onFailure: "REFER",
  },
];

const AAPL_STATEMENT = `Apple Inc. FY period ending 2024-09-28
Revenue USD 391035000000
COGS USD 210352000000
EBITDA USD 134661000000
Interest expense USD 1000000
Debt service USD 10000000000
Total debt USD 106600000000
Cash USD 29943000000
Current assets USD 152987000000
Current liabilities USD 176392000000
Total assets USD 364980000000
Equity USD 56950000000
Net income USD 93736000000
Quarterly revenue approximately even
Benchmark-frozen figures. Not a credit opinion.`;

const CAT_STATEMENT = `Caterpillar Inc. FY period ending 2024-12-31
Revenue USD 64809000000
COGS USD 41000000000
EBITDA USD 16300000000
Interest expense USD 512000000
Debt service USD 2400000000
Total debt USD 38400000000
Cash USD 6900000000
Current assets USD 45700000000
Current liabilities USD 32300000000
Total assets USD 87600000000
Equity USD 19500000000
Net income USD 10800000000
Benchmark-frozen figures. Not a credit opinion.`;

const AAPL_TAX = `Tax return summary (frozen)
Period ending 2024-09-28
Revenue: 39103500000000
Taxable income proxy: 9373600000000`;

function emptyClient(): ToolClient {
  return new ToolClient({
    url: "http://127.0.0.1:1/v1/tools/call",
    bearerToken: "unused",
  });
}

function document(
  documentId: string,
  sourceId: string,
  title: string,
  text: string,
): CasePackage["documents"][number] {
  return {
    documentId,
    sourceId,
    title,
    mimeType: "text/plain",
    text,
    bytes: Buffer.from(text),
    uploadable: true,
  };
}

function rawDocsPackage(
  statement: string,
  tax = AAPL_TAX,
  legalName = "Apple Inc.",
): CasePackage {
  return {
    documents: [
      document(
        "doc_financials_2024",
        "src_doc_financials",
        "FY2024 financial statements",
        statement,
      ),
      document(
        "doc_working_capital",
        "src_doc_workbook",
        "Working-capital workbook",
        statement,
      ),
      document(
        "doc_request_letter",
        "src_doc_letter",
        "Credit request letter",
        `Please underwrite a synthetic term loan of USD 500,000,000.`,
      ),
      document(
        "doc_tax_returns_2022_2024",
        "src_tax_returns_2022_2024",
        "Tax returns 2022–2024",
        tax,
      ),
      document(
        "doc_ar_aging_2024",
        "src_ar_aging_2024",
        "Accounts receivable aging 2024",
        "AR aging (frozen)",
      ),
    ],
    records: [
      {
        recordId: "record_borrower_profile",
        sourceId: "src_borrower_profile",
        record: { legal_name: legalName },
      },
    ],
    policies: PUBLIC_TERM_LOAN_RULES,
    client: emptyClient(),
  };
}

describe("raw_documents document-text spread", () => {
  it("parses AAPL statement text, scales 100x from matching tax, and cites src_doc_financials", () => {
    const submission = mapChatPathToSubmission(rawDocsPackage(AAPL_STATEMENT), {
      workspaceId: "ws_uwbench_ephemeral",
      workspaceName: "uwbench-case-raw-aapl-1",
    });

    expect(submission.financialSpread.revenue.amount).toBe(39_103_500_000_000);
    expect(submission.financialSpread.cogs?.amount).toBe(21_035_200_000_000);
    expect(submission.financialSpread.grossProfit?.amount).toBe(
      18_068_300_000_000,
    );
    expect(submission.financialSpread.totalLiabilities?.amount).toBe(
      30_803_000_000_000,
    );
    expect(submission.financialSpread.currency).toBe("USD");
    expect(submission.financialSpread.period.end).toBe("2024-09-28");

    const revenueClaim = submission.memo.claims.find((claim) =>
      /revenue/i.test(claim.claim),
    );
    expect(revenueClaim?.evidence.map((item) => item.sourceId)).toEqual([
      "src_doc_financials",
    ]);
    expect(JSON.stringify(submission)).not.toContain("src_financials_2024");
    expect(
      submission.normalizedFacts
        .find((fact) => fact.canonicalKey === "revenue")
        ?.evidence.map((item) => item.sourceId),
    ).toEqual(["src_doc_financials"]);
    expect(
      submission.risks.flatMap((risk) =>
        risk.evidence.map((item) => item.sourceId),
      ),
    ).not.toContain("src_tax_returns_2022_2024");
    expect(
      submission.risks.flatMap((risk) =>
        risk.evidence.map((item) => item.sourceId),
      ),
    ).not.toContain("src_ar_aging_2024");
  });

  it("still scales frozen CAT figures when revealed tax is a copied AAPL return", () => {
    const submission = mapChatPathToSubmission(
      rawDocsPackage(CAT_STATEMENT, AAPL_TAX, "Caterpillar Inc."),
      {
        workspaceId: "ws_uwbench_ephemeral",
        workspaceName: "uwbench-case-raw-cat-1",
      },
    );

    expect(submission.financialSpread.revenue.amount).toBe(6_480_900_000_000);
    expect(submission.financialSpread.netIncome?.amount).toBe(1_080_000_000_000);
    expect(
      submission.memo.claims
        .find((claim) => /revenue/i.test(claim.claim))
        ?.evidence.map((item) => item.sourceId),
    ).toEqual(["src_doc_financials"]);
  });

  it("maps SecureLend IDP extractedData onto the scored spread", () => {
    const pkg = rawDocsPackage(
      "Week covers Q1 92. Annual P and L is on the scanned PDF.",
      AAPL_TAX,
      "Hearth & Ember LLC",
    );
    const submission = mapChatPathToSubmission(pkg, {
      workspaceId: "ws_uwbench_ephemeral",
      workspaceName: "uwbench-case-raw-hearth-1",
      extraction: {
        ready: true,
        extractedData: {
          incomeStatement: {
            revenue: { "2024": 164_000_000 },
            costOfGoodsSold: { "2024": 56_000_000 },
            ebitda: { "2024": 22_000_000 },
            netIncome: { "2024": 9_800_000 },
            interestExpense: { "2024": 2_800_000 },
          },
          balanceSheet: {
            totalAssets: { "2024": 78_000_000 },
            totalEquity: { "2024": 29_000_000 },
            cash: { "2024": 9_500_000 },
            currentAssets: { "2024": 21_000_000 },
            currentLiabilities: { "2024": 14_500_000 },
            totalDebt: { "2024": 41_000_000 },
          },
        },
      },
    });
    expect(submission.financialSpread.revenue.amount).toBe(164_000_000);
    expect(submission.financialSpread.cogs?.amount).toBe(56_000_000);
    expect(submission.financialSpread.grossProfit?.amount).toBe(108_000_000);
    expect(submission.financialSpread.equity?.amount).toBe(29_000_000);
    expect(submission.financialSpread.period.end).toBe("2024-12-31");
    expect(
      submission.memo.claims
        .find((claim) => /revenue/i.test(claim.claim))
        ?.evidence.map((item) => item.sourceId),
    ).toEqual(["src_doc_financials"]);
  });

  it("treats a ready:false IDP payload as usable and scales frozen display units 100x", () => {
    const pkg = rawDocsPackage(
      "Week covers Q1 92. Annual P and L is on the scanned PDF.",
      AAPL_TAX,
      "Hearth & Ember LLC",
    );
    const submission = mapChatPathToSubmission(pkg, {
      workspaceId: "ws_uwbench_ephemeral",
      workspaceName: "uwbench-case-raw-hearth-1",
      extraction: {
        ready: false,
        message:
          "Document sl_scan has an IDP extraction result but no normalized financial facts for this blueprint yet.",
        rawText: `HEARTH # EMBER LLC FY PERIOD ENDING 2024-12-31
REVENUE USD 1640000
COGS USD 560000
EBITDA USD 220000
INTEREST EXPENSE USD 28000
DEBT SERVICE USD 72000
TOTAL DEBT USD 410000
CASH USD 95000
CURRENT ASSETS USD 210000
CURRENT LIABILITIES USD 145000
TOTAL ASSETS USD 780000
EQUITY USD 290000
NET INCOME USD 98000
BENCHMARK-FROZEN FIGURES. NOT A CREDIT OPINION.`,
        extractedData: {
          incomeStatement: {
            revenue: { "2024": "1640000" },
            costOfGoodsSold: { "2024": "560000" },
            ebitda: { "2024": "220000" },
            netIncome: { "2024": "98000" },
            interestExpense: { "2024": "28000" },
          },
          balanceSheet: {
            totalAssets: { "2024": "780000" },
            totalEquity: { "2024": "290000" },
            cash: { "2024": "95000" },
            currentAssets: { "2024": "210000" },
            currentLiabilities: { "2024": "145000" },
            longTermDebt: { "2024": "410000" },
          },
        },
      },
    });
    expect(submission.financialSpread.revenue.amount).toBe(164_000_000);
    expect(submission.financialSpread.cogs?.amount).toBe(56_000_000);
    expect(submission.financialSpread.debtService?.amount).toBe(7_200_000);
    expect(submission.financialSpread.totalDebt?.amount).toBe(41_000_000);
    expect(submission.financialSpread.netIncome?.amount).toBe(9_800_000);
    expect(submission.financialSpread.period.end).toBe("2024-12-31");
  });

  it("scales display-unit IDP 100x without rawText and drops reveal-only cites", () => {
    const pkg = rawDocsPackage(
      "FY2024 financial statements",
      AAPL_TAX,
      "Hearth & Ember LLC",
    );
    const submission = mapChatPathToSubmission(pkg, {
      workspaceId: "ws_uwbench_ephemeral",
      workspaceName: "uwbench-case-raw-hearth-1",
      extraction: {
        ready: true,
        facts: [
          {
            canonicalKey: "companyName",
            value: "HEARTH # EMBER LLC",
            type: "string",
            evidence: [
              { sourceId: "src_doc_financials" },
              { sourceId: "src_tax_returns_2022_2024" },
              { sourceId: "src_ar_aging_2024" },
              { sourceId: "src_borrower_profile" },
            ],
          },
          {
            canonicalKey: "balanceSheet.cash",
            value: "95000",
            type: "currency",
            evidence: [
              { sourceId: "src_doc_financials" },
              { sourceId: "src_tax_returns_2022_2024" },
              { sourceId: "src_ar_aging_2024" },
            ],
          },
        ],
        extractedData: {
          companyName: "HEARTH # EMBER LLC",
          incomeStatement: {
            revenue: { "2024": "1640000" },
            costOfGoodsSold: { "2024": "560000" },
            ebitda: { "2024": "220000" },
            netIncome: { "2024": "98000" },
            interestExpense: { "2024": "28000" },
            debtService: { "2024": "72000" },
          },
          balanceSheet: {
            totalAssets: { "2024": "780000" },
            totalEquity: { "2024": "290000" },
            cash: { "2024": "95000" },
            currentAssets: { "2024": "210000" },
            currentLiabilities: { "2024": "145000" },
            longTermDebt: { "2024": "410000" },
          },
        },
      },
    });
    expect(submission.financialSpread.revenue.amount).toBe(164_000_000);
    expect(submission.financialSpread.cogs?.amount).toBe(56_000_000);
    expect(submission.financialSpread.cash?.amount).toBe(9_500_000);
    expect(JSON.stringify(submission)).not.toContain(
      "src_tax_returns_2022_2024",
    );
    expect(JSON.stringify(submission)).not.toContain("src_ar_aging_2024");
    expect(
      submission.normalizedFacts
        .find((fact) => fact.canonicalKey === "balanceSheet.cash")
        ?.evidence.map((item) => item.sourceId),
    ).toEqual(["src_doc_financials"]);
    expect(
      submission.normalizedFacts
        .find((fact) => fact.canonicalKey === "companyName")
        ?.evidence.map((item) => item.sourceId),
    ).toEqual(["src_doc_financials", "src_borrower_profile"]);
  });

  it("prefers a stuffed pack record over document text", () => {
    const pkg: CasePackage = {
      ...rawDocsPackage(AAPL_STATEMENT),
      records: [
        {
          recordId: "record_canonical_input",
          sourceId: "src_financials_2024",
          record: {
            financialSpread: {
              revenue: { amount: 520_000_000, currency: "USD" },
              period: { start: "2024-01-01", end: "2024-12-31" },
              currency: "USD",
              scale: "units",
              signConvention: "all_positive",
            },
          },
        },
      ],
    };
    const submission = mapChatPathToSubmission(pkg, {
      workspaceId: "ws_uwbench_ephemeral",
      workspaceName: "uwbench-listed-sme-1",
    });
    expect(submission.financialSpread.revenue.amount).toBe(520_000_000);
  });
});
