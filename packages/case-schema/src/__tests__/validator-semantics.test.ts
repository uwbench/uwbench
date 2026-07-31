import { describe, it, expect } from "vitest";
import {
  validateCaseSemantics,
  validateCaseSemanticsSync,
  SemanticDiagnosticCode,
} from "../validator.js";
import type { Case } from "../case.js";

describe("Semantic Validation", () => {
  const baseCase: Case = {
    schema_version: "1.0",
    case_id: "case-00001",
    track: "commercial-credit",
    benchmark_version: "0.1.0",
    jurisdiction: "US",
    as_of_date: "2025-12-31",
    currency: "USD",
    requested_product: "term_loan",
    requested_amount: 1000000,
    supported_lanes: ["raw_documents", "normalized_data", "reasoning_only"],
    features: {
      missing_information: true,
      conflicting_information: true,
      fraud_signal: false,
    },
    budgets: {
      max_duration_seconds: 900,
      max_tool_calls: 100,
    },
    sources: [
      {
        kind: "document",
        sourceId: "src_001",
        documentId: "doc_001",
        title: "Financial Statement",
        mimeType: "application/pdf",
        pageCount: 10,
        totalCharacterCount: 5000,
        pii: false,
        legalUse: "public_record",
      },
      {
        kind: "record",
        sourceId: "src_002",
        recordId: "rec_001",
        title: "Extracted Financials",
        schema: "financials.v1",
        rowCount: 100,
        columns: ["revenue", "expenses", "net_income"],
        pii: false,
        legalUse: "borrower_consent",
      },
      {
        kind: "policy",
        sourceId: "src_003",
        title: "Credit Policy 2025",
        version: "1.0",
        effectiveDate: "2025-01-01",
        jurisdiction: "US",
        pii: false,
        legalUse: "not_applicable",
      },
    ],
    policyTests: [
      {
        ruleId: "rule_001",
        appliesWhen: [
          {
            input: { source: "fact", key: "dscr" },
            operator: "gte",
            threshold: 1.25,
          },
        ],
        onFailure: "DECLINE",
        severity: "CRITICAL",
        evidence: [
          {
            sourceId: "src_001",
            documentId: "doc_001",
            anchor: { type: "page", page: 5 },
          },
        ],
      },
    ],
    piiDeclarations: [
      {
        sourceId: "src_002",
        containsPii: false,
        legalUse: "borrower_consent",
        redactionStatus: "none",
      },
    ],
  };

  function createCase(overrides: Partial<Case> = {}): Case {
    return { ...baseCase, ...overrides };
  }

  describe("validateCaseSemantics / validateCaseSemanticsSync", () => {
    it("accepts a valid case with sources, policy tests, and PII declarations", () => {
      const result = validateCaseSemantics(baseCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);

      const syncResult = validateCaseSemanticsSync(baseCase);
      expect(syncResult.success).toBe(true);
      expect(syncResult.diagnostics).toHaveLength(0);
    });

    it("rejects citation with unknown sourceId", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "unknown_source",
                documentId: "doc_001",
                anchor: { type: "page", page: 5 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_UNKNOWN_SOURCE,
        ),
      ).toBe(true);
    });

    it("rejects citation with both documentId and recordId (ambiguous)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "doc_001",
                recordId: "rec_001",
                anchor: { type: "page", page: 5 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_AMBIGUOUS_IDS,
        ),
      ).toBe(true);
    });

    it("rejects page anchor out of bounds", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "doc_001",
                anchor: { type: "page", page: 15 }, // pageCount is 10
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_PAGE_OUT_OF_BOUNDS,
        ),
      ).toBe(true);
    });

    it("rejects page range with startPage > endPage (reversed)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "doc_001",
                anchor: { type: "page_range", startPage: 5, endPage: 3 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_PAGE_RANGE_REVERSED,
        ),
      ).toBe(true);
    });

    it("rejects page range endPage out of bounds", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "doc_001",
                anchor: { type: "page_range", startPage: 5, endPage: 15 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.CITATION_PAGE_RANGE_OUT_OF_BOUNDS,
        ),
      ).toBe(true);
    });

    it("accepts valid page boundary values (page 1 and pageCount)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "doc_001",
                anchor: { type: "page", page: 1 }, // minimum valid page
              },
              {
                sourceId: "src_001",
                documentId: "doc_001",
                anchor: { type: "page", page: 10 }, // maximum valid page (pageCount = 10)
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("accepts valid page range boundary values", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "doc_001",
                anchor: { type: "page_range", startPage: 1, endPage: 10 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("rejects character range with startOffset > endOffset (reversed)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "doc_001",
                anchor: {
                  type: "character_range",
                  startOffset: 100,
                  endOffset: 50,
                },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_CHAR_RANGE_REVERSED,
        ),
      ).toBe(true);
    });

    it("rejects row anchor with rowIndex out of bounds", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002",
                recordId: "rec_001",
                anchor: { type: "row", rowIndex: 150 }, // rowCount is 100
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_ROW_OUT_OF_BOUNDS,
        ),
      ).toBe(true);
    });

    it("rejects row anchor with unknown column", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002",
                recordId: "rec_001",
                anchor: { type: "row", rowIndex: 0, column: "unknown_column" },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_UNKNOWN_COLUMN,
        ),
      ).toBe(true);
    });

    it("rejects row range with startRow > endRow (reversed)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002",
                recordId: "rec_001",
                anchor: { type: "row_range", startRow: 10, endRow: 5 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_ROW_RANGE_REVERSED,
        ),
      ).toBe(true);
    });

    it("rejects row range endRow out of bounds", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002",
                recordId: "rec_001",
                anchor: { type: "row_range", startRow: 0, endRow: 150 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.CITATION_ROW_RANGE_OUT_OF_BOUNDS,
        ),
      ).toBe(true);
    });

    it("accepts valid row boundary values (rowIndex 0 and rowCount-1)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002",
                recordId: "rec_001",
                anchor: { type: "row", rowIndex: 0 }, // minimum valid row
              },
              {
                sourceId: "src_002",
                recordId: "rec_001",
                anchor: { type: "row", rowIndex: 99 }, // maximum valid row (rowCount - 1)
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("accepts valid row range boundary values", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002",
                recordId: "rec_001",
                anchor: { type: "row_range", startRow: 0, endRow: 99 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("rejects anchor type mismatch with source kind (page anchor on record source)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002", // record source
                recordId: "rec_001",
                anchor: { type: "page", page: 1 }, // page anchor on record
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.CITATION_ANCHOR_KIND_MISMATCH,
        ),
      ).toBe(true);
    });

    it("rejects anchor type mismatch with source kind (row anchor on document source)", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001", // document source
                documentId: "doc_001",
                anchor: { type: "row", rowIndex: 0 }, // row anchor on document
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.CITATION_ANCHOR_KIND_MISMATCH,
        ),
      ).toBe(true);
    });

    it("rejects documentId that does not match source documentId", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                documentId: "wrong_doc_id",
                anchor: { type: "page", page: 1 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.CITATION_DOCUMENT_ID_MISMATCH,
        ),
      ).toBe(true);
    });

    it("rejects recordId that does not match source recordId", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_002",
                recordId: "wrong_rec_id",
                anchor: { type: "row", rowIndex: 0 },
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.CITATION_RECORD_ID_MISMATCH,
        ),
      ).toBe(true);
    });

    it("rejects duplicate sourceId in sources array", () => {
      const testCase = createCase({
        sources: [
          {
            kind: "document",
            sourceId: "src_001",
            documentId: "doc_001",
            title: "Financial Statement",
            mimeType: "application/pdf",
            pageCount: 10,
            pii: false,
            legalUse: "public_record",
          },
          {
            kind: "document",
            sourceId: "src_001", // duplicate
            documentId: "doc_002",
            title: "Another Document",
            mimeType: "application/pdf",
            pageCount: 5,
            pii: false,
            legalUse: "public_record",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.DUPLICATE_SOURCE_ID,
        ),
      ).toBe(true);
    });

    it("rejects duplicate ruleId in policyTests array", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
          },
          {
            ruleId: "rule_001", // duplicate
            appliesWhen: [
              {
                input: { source: "fact", key: "ltv" },
                operator: "lte",
                threshold: 0.8,
              },
            ],
            onFailure: "REFER",
            severity: "HIGH",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.DUPLICATE_RULE_ID,
        ),
      ).toBe(true);
    });

    it("rejects policy test with empty appliesWhen array", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [], // empty
            onFailure: "DECLINE",
            severity: "CRITICAL",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.POLICY_TEST_EMPTY_APPLIES_WHEN,
        ),
      ).toBe(true);
    });

    it("rejects policy test with invalid onFailure value", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "INVALID_DECISION" as any,
            severity: "CRITICAL",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.POLICY_TEST_INVALID_ON_FAILURE,
        ),
      ).toBe(true);
    });

    it("accepts all valid onFailure values", () => {
      const validDecisions = [
        "DECLINE",
        "REFER",
        "CONDITION",
        "EXCEPTION_REQUIRED",
      ];
      for (const decision of validDecisions) {
        const testCase = createCase({
          policyTests: [
            {
              ruleId: `rule_${decision}`,
              appliesWhen: [
                {
                  input: { source: "fact", key: "dscr" },
                  operator: "gte",
                  threshold: 1.25,
                },
              ],
              onFailure: decision as any,
              severity: "CRITICAL",
            },
          ],
        });

        const result = validateCaseSemantics(testCase);
        expect(result.success).toBe(true);
      }
    });

    it("rejects PII declaration with unknown sourceId", () => {
      const testCase = createCase({
        piiDeclarations: [
          {
            sourceId: "unknown_source",
            containsPii: true,
            legalUse: "borrower_consent",
            redactionStatus: "partial",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === SemanticDiagnosticCode.PII_DECLARATION_UNKNOWN_SOURCE,
        ),
      ).toBe(true);
    });

    it("rejects duplicate PII declaration for same sourceId", () => {
      const testCase = createCase({
        piiDeclarations: [
          {
            sourceId: "src_002",
            containsPii: false,
            legalUse: "borrower_consent",
            redactionStatus: "none",
          },
          {
            sourceId: "src_002", // duplicate
            containsPii: true,
            legalUse: "regulatory_exemption",
            redactionStatus: "partial",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.DUPLICATE_PII_DECLARATION,
        ),
      ).toBe(true);
    });

    it("rejects PII declaration with legalUse=not_applicable when containsPii=true", () => {
      const testCase = createCase({
        piiDeclarations: [
          {
            sourceId: "src_002",
            containsPii: true,
            legalUse: "not_applicable", // conflict
            redactionStatus: "none",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.PII_LEGAL_USE_CONFLICT,
        ),
      ).toBe(true);
    });

    it("accepts PII declaration with legalUse=not_applicable when containsPii=false", () => {
      const testCase = createCase({
        piiDeclarations: [
          {
            sourceId: "src_002",
            containsPii: false,
            legalUse: "not_applicable",
            redactionStatus: "none",
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("rejects source with pii=true that lacks PII declaration", () => {
      const testCase = createCase({
        sources: [
          {
            kind: "document",
            sourceId: "src_pii",
            documentId: "doc_pii",
            title: "PII Document",
            mimeType: "application/pdf",
            pageCount: 5,
            pii: true,
            legalUse: "borrower_consent",
          },
        ],
        piiDeclarations: [], // missing declaration for src_pii
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.code === SemanticDiagnosticCode.PII_MISSING_LEGAL_USE,
        ),
      ).toBe(true);
    });

    it("accepts source with pii=true that has matching PII declaration", () => {
      const testCase = createCase({
        sources: [
          {
            kind: "document",
            sourceId: "src_pii",
            documentId: "doc_pii",
            title: "PII Document",
            mimeType: "application/pdf",
            pageCount: 5,
            pii: true,
            legalUse: "borrower_consent",
          },
        ],
        piiDeclarations: [
          {
            sourceId: "src_pii",
            containsPii: true,
            legalUse: "borrower_consent",
            redactionStatus: "partial",
          },
        ],
        policyTests: [],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("accepts citation without optional documentId/recordId/anchor", () => {
      const testCase = createCase({
        policyTests: [
          {
            ruleId: "rule_001",
            appliesWhen: [
              {
                input: { source: "fact", key: "dscr" },
                operator: "gte",
                threshold: 1.25,
              },
            ],
            onFailure: "DECLINE",
            severity: "CRITICAL",
            evidence: [
              {
                sourceId: "src_001",
                // no documentId, recordId, or anchor
              },
            ],
          },
        ],
      });

      const result = validateCaseSemantics(testCase);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
