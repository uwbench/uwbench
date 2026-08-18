import { describe, expect, it } from "vitest";
import { unwrapMcpToolResult } from "./mcp-client.js";
import { isExtractionReady } from "./chat-path.js";
import {
  applyBenchmarkScale,
  collectIdpAmounts,
  idpNumeric,
  isUsableSpread,
  spreadFromDocumentText,
  spreadFromIdpExtraction,
} from "./submission-map.js";

const HEARTH_OCR = [
  "HEARTH & EMBER LLC",
  "REVENUE USD 1640000",
  "COGS USD 560000",
  "EBITDA USD 220000",
  "INTEREST USD 28000",
  "DEBT SERVICE USD 72000",
  "TOTAL DEBT USD 410000",
  "CASH USD 95000",
  "CURRENT ASSETS USD 210000",
  "CURRENT LIABILITIES USD 145000",
  "TOTAL ASSETS USD 780000",
  "EQUITY USD 290000",
  "NET INCOME USD 98000",
  "PERIOD ENDING 2024-12-31",
  "BENCHMARK-FROZEN FIGURES. NOT A CREDIT OPINION.",
].join("\n");

const HEARTH_EXTRACTED = {
  incomeStatement: {
    revenue: { "2024": "1640000" },
    cogs: { "2024": "560000", unused: { NULL: true } },
    ebitda: { "2024": "220000" },
    interestExpense: { "2024": "28000" },
    netIncome: { "2024": "98000" },
  },
  balanceSheet: {
    cash: { "2024": "95000" },
    currentAssets: { "2024": "210000" },
    currentLiabilities: { "2024": "145000" },
    totalAssets: { "2024": "780000" },
    totalDebt: { "2024": "410000" },
    equity: { "2024": "290000" },
    debtService: { "2024": "72000" },
  },
};

describe("document-text frozen/tax scale", () => {
  it("parses labeled statement text and applies 100× for frozen figures", () => {
    const parsed = spreadFromDocumentText(
      [
        "Federal Signal Corporation FY period ending 2024-12-31",
        "Revenue USD 1861000000",
        "COGS USD 1320000000",
        "EBITDA USD 261000000",
        "Interest expense USD 16000000",
        "Debt service USD 42000000",
        "Total debt USD 280000000",
        "Cash USD 91000000",
        "Current assets USD 720000000",
        "Current liabilities USD 310000000",
        "Total assets USD 1640000000",
        "Equity USD 920000000",
        "Net income USD 177000000",
        "Benchmark-frozen figures. Not a credit opinion.",
      ].join("\n"),
    );
    expect(parsed).toBeDefined();
    expect(parsed?.revenue.amount).toBe(1_861_000_000);
    const scaled = applyBenchmarkScale(parsed!, [
      "Benchmark-frozen figures. Not a credit opinion.",
    ]);
    expect(scaled.revenue.amount).toBe(186_100_000_000);
    expect(scaled.ebitda?.amount).toBe(26_100_000_000);
    expect(isUsableSpread(scaled)).toBe(true);
  });

  it("does not scale from copy-pasted AAPL tax unless the factor is in [10, 1000]", () => {
    const other = spreadFromDocumentText(
      "Revenue USD 2000000\nCOGS USD 800000\nEBITDA USD 300000\nPeriod ending 2024-12-31",
    );
    expect(other?.revenue.amount).toBe(2_000_000);
    const fromTax = applyBenchmarkScale(
      other!,
      ["Tax return summary\nRevenue: 39103500000000"],
      39_103_500_000_000,
    );
    expect(fromTax.revenue.amount).toBe(2_000_000);
    const hearth = applyBenchmarkScale(
      spreadFromDocumentText(HEARTH_OCR)!,
      [HEARTH_OCR],
      39_103_500_000_000,
    );
    expect(hearth.revenue.amount).toBe(164_000_000);
  });
});

describe("IDP extractedData mapping", () => {
  it("flattens year-map extractedData and 100× scales frozen-figure OCR", () => {
    const spread = spreadFromIdpExtraction(
      {
        ready: false,
        message:
          "Document has an IDP extraction result but no normalized financial facts",
        extractedData: HEARTH_EXTRACTED,
        rawText: HEARTH_OCR,
      },
      { texts: [HEARTH_OCR] },
    );
    expect(spread).toBeDefined();
    expect(isUsableSpread(spread)).toBe(true);
    expect(spread?.currency).toBe("USD");
    expect(spread?.revenue.amount).toBe(164_000_000);
    expect(spread?.cogs?.amount).toBe(56_000_000);
    expect(spread?.ebitda?.amount).toBe(22_000_000);
    expect(spread?.interestExpense?.amount).toBe(2_800_000);
    expect(spread?.debtService?.amount).toBe(7_200_000);
    expect(spread?.totalDebt?.amount).toBe(41_000_000);
    expect(spread?.cash?.amount).toBe(9_500_000);
    expect(spread?.currentAssets?.amount).toBe(21_000_000);
    expect(spread?.currentLiabilities?.amount).toBe(14_500_000);
    expect(spread?.totalAssets?.amount).toBe(78_000_000);
    expect(spread?.equity?.amount).toBe(29_000_000);
    expect(spread?.netIncome?.amount).toBe(9_800_000);
    expect(spread?.period.end).toBe("2024-12-31");
  });

  it("reads Dynamo-ish NULL siblings and string year maps", () => {
    expect(idpNumeric({ NULL: true })).toBeUndefined();
    expect(idpNumeric({ N: "1640000" })).toBe(1_640_000);
    expect(idpNumeric({ "2024": "1640000", unused: { NULL: true } })).toBe(
      1_640_000,
    );
    const amounts = collectIdpAmounts({
      incomeStatement: { revenue: { "2023": "1", "2024": "1640000" } },
    });
    expect(amounts.revenue).toBe(1_640_000);
  });

  it("treats extractedData as ready even when ready is false", () => {
    expect(
      isExtractionReady({
        ready: false,
        message: "no IDP extraction result yet",
      }),
    ).toBe(false);
    expect(
      isExtractionReady({
        ready: false,
        message:
          "Document has an IDP extraction result but no normalized financial facts",
        extractedData: HEARTH_EXTRACTED,
      }),
    ).toBe(true);
    expect(
      unwrapMcpToolResult({
        content: [
          {
            type: "text",
            text: "Document has an IDP extraction result but no normalized financial facts",
          },
        ],
        structuredContent: {
          ready: false,
          extractedData: HEARTH_EXTRACTED,
        },
      }),
    ).toMatchObject({
      ready: false,
      extractedData: HEARTH_EXTRACTED,
      message:
        "Document has an IDP extraction result but no normalized financial facts",
    });
  });
});
