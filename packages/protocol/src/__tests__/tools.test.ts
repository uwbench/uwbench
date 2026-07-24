import { describe, it, expect } from "vitest";
import {
  ToolCallSchema,
  ToolResultSchema,
  ToolErrorSchema,
  CaseListDocumentsSchema,
  CaseGetDocumentMetadataSchema,
  CaseReadDocumentSchema,
  CaseSearchDocumentsSchema,
  CaseGetStructuredRecordSchema,
  CaseRequestInformationSchema,
  PolicySearchSchema,
  PolicyGetRuleSchema,
  FinanceCalculateSchema,
  FinanceCalculateRatiosSchema,
  FinanceValidateSpreadSchema,
  SubmissionSaveArtifactSchema,
  TOOL_SCHEMAS,
  TOOL_NAMES,
  TOOL_CATEGORIES,
  isValidToolName,
  getToolCategory,
  validateToolInput,
  validateToolOutput,
  validateToolError,
} from "../tools.js";

const citationAnchor = {
  sourceId: "source_1",
  documentId: "doc_1",
  page: 1,
};

describe("Tool Protocol Base Schemas", () => {
  describe("ToolCallSchema", () => {
    it("accepts valid tool call", () => {
      const call = {
        schemaVersion: "1.0",
        callId: "call_001",
        name: "case.read_document",
        arguments: { documentId: "doc_123", pages: [1, 2] },
      };
      const result = ToolCallSchema.safeParse(call);
      expect(result.success).toBe(true);
    });

    it("rejects missing callId", () => {
      const result = ToolCallSchema.safeParse({
        schemaVersion: "1.0",
        name: "case.read_document",
        arguments: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing name", () => {
      const result = ToolCallSchema.safeParse({
        schemaVersion: "1.0",
        callId: "call_001",
        arguments: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty callId", () => {
      const result = ToolCallSchema.safeParse({
        schemaVersion: "1.0",
        callId: "",
        name: "case.read_document",
        arguments: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown tools and arguments for the wrong tool", () => {
      expect(
        ToolCallSchema.safeParse({
          schemaVersion: "1.0",
          callId: "call_001",
          name: "case.unknown",
          arguments: {},
        }).success,
      ).toBe(false);
      expect(
        ToolCallSchema.safeParse({
          schemaVersion: "1.0",
          callId: "call_002",
          name: "case.read_document",
          arguments: { query: "revenue" },
        }).success,
      ).toBe(false);
    });
  });

  describe("ToolResultSchema", () => {
    it("accepts successful result", () => {
      const result = {
        schemaVersion: "1.0",
        callId: "call_001",
        ok: true,
        name: "finance.calculate",
        result: { result: 42 },
      };
      const parsed = ToolResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    it("accepts an error result", () => {
      const result = {
        schemaVersion: "1.0",
        callId: "call_001",
        ok: false,
        name: "case.read_document",
        error: { code: "NOT_FOUND", message: "Document not found" },
      };
      const parsed = ToolResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    it("rejects missing callId", () => {
      const result = ToolResultSchema.safeParse({
        schemaVersion: "1.0",
        ok: true,
        name: "finance.calculate",
        result: { foo: "bar" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects envelopes containing both result and error", () => {
      expect(
        ToolResultSchema.safeParse({
          schemaVersion: "1.0",
          callId: "call_001",
          ok: true,
          name: "finance.calculate",
          result: { result: 42 },
          error: { code: "TOOL_ERROR", message: "ambiguous" },
        }).success,
      ).toBe(false);
    });
  });

  describe("ToolErrorSchema", () => {
    it("accepts valid error", () => {
      const error = {
        code: "NOT_FOUND",
        message: "Document not found",
        details: { documentId: "doc_123" },
      };
      const result = ToolErrorSchema.safeParse(error);
      expect(result.success).toBe(true);
    });

    it("accepts error without details", () => {
      const error = { code: "NOT_FOUND", message: "Document not found" };
      const result = ToolErrorSchema.safeParse(error);
      expect(result.success).toBe(true);
    });

    it("rejects missing code", () => {
      const result = ToolErrorSchema.safeParse({ message: "Error" });
      expect(result.success).toBe(false);
    });
  });
});

describe("Case Tool Schemas", () => {
  describe("CaseListDocumentsSchema", () => {
    it("accepts empty input", () => {
      const result = CaseListDocumentsSchema.shape.input.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        documents: [
          {
            documentId: "doc_1",
            sourceId: "source_1",
            title: "Financial Statement",
            mimeType: "application/pdf",
            pageCount: 10,
          },
        ],
      };
      const result = CaseListDocumentsSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("accepts output without pageCount", () => {
      const output = {
        documents: [
          {
            documentId: "doc_1",
            sourceId: "source_1",
            title: "Financial Statement",
            mimeType: "application/pdf",
          },
        ],
      };
      const result = CaseListDocumentsSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("CaseGetDocumentMetadataSchema", () => {
    it("accepts valid input", () => {
      const input = { documentId: "doc_1" };
      const result = CaseGetDocumentMetadataSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        documentId: "doc_1",
        sourceId: "source_1",
        title: "Financial Statement",
        mimeType: "application/pdf",
        pageCount: 10,
        sizeBytes: 102400,
        sha256: "a".repeat(64),
      };
      const result =
        CaseGetDocumentMetadataSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("rejects invalid sha256 length", () => {
      const output = {
        documentId: "doc_1",
        title: "Financial Statement",
        mimeType: "application/pdf",
        pageCount: 10,
        sizeBytes: 102400,
        sha256: "short",
      };
      const result =
        CaseGetDocumentMetadataSchema.shape.output.safeParse(output);
      expect(result.success).toBe(false);
    });
  });

  describe("CaseReadDocumentSchema", () => {
    it("accepts input with pages", () => {
      const input = { documentId: "doc_1", pages: [1, 2, 3] };
      const result = CaseReadDocumentSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts input without pages", () => {
      const input = { documentId: "doc_1" };
      const result = CaseReadDocumentSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        documentId: "doc_1",
        sourceId: "source_1",
        content: "Full document text...",
        pages: [
          { pageNumber: 1, text: "Page 1", citationAnchor },
          {
            pageNumber: 2,
            text: "Page 2",
            citationAnchor: { ...citationAnchor, page: 2 },
          },
        ],
      };
      const result = CaseReadDocumentSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("CaseSearchDocumentsSchema", () => {
    it("accepts input with query and limit", () => {
      const input = { query: "revenue", limit: 10 };
      const result = CaseSearchDocumentsSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts input with only query", () => {
      const input = { query: "revenue" };
      const result = CaseSearchDocumentsSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        results: [
          {
            documentId: "doc_1",
            sourceId: "source_1",
            snippet: "Revenue was $1M",
            score: 0.95,
            citationAnchor,
          },
        ],
      };
      const result = CaseSearchDocumentsSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("CaseGetStructuredRecordSchema", () => {
    it("accepts valid input", () => {
      const input = { recordId: "rec_1" };
      const result = CaseGetStructuredRecordSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output with record", () => {
      const output = {
        sourceId: "source_1",
        record: { field1: "value1", field2: 123 },
        citationAnchors: [citationAnchor],
      };
      const result =
        CaseGetStructuredRecordSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("CaseRequestInformationSchema", () => {
    it("accepts valid input", () => {
      const input = {
        concept: "revenue_verification",
        question: "What was the revenue for 2023?",
        context: "Need to verify reported revenue",
      };
      const result = CaseRequestInformationSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts input without context", () => {
      const input = {
        concept: "revenue_verification",
        question: "What was the revenue for 2023?",
      };
      const result = CaseRequestInformationSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts AVAILABLE output", () => {
      const output = {
        status: "AVAILABLE",
        revealedDocumentIds: ["doc_5", "doc_6"],
      };
      const result =
        CaseRequestInformationSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("accepts NEEDS_CLARIFICATION output", () => {
      const output = {
        status: "NEEDS_CLARIFICATION",
        clarification: "Please specify which year",
      };
      const result =
        CaseRequestInformationSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("accepts ALREADY_PROVIDED output", () => {
      const output = { status: "ALREADY_PROVIDED" };
      const result =
        CaseRequestInformationSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});

describe("Policy Tool Schemas", () => {
  describe("PolicySearchSchema", () => {
    it("accepts valid input", () => {
      const input = { query: "leverage ratio", limit: 5 };
      const result = PolicySearchSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        rules: [
          {
            ruleId: "rule_1",
            sourceId: "policy_1",
            title: "Max Leverage",
            snippet: "Leverage must not exceed 3x",
            citationAnchors: [
              { sourceId: "policy_1", startOffset: 10, endOffset: 48 },
            ],
          },
        ],
      };
      const result = PolicySearchSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("PolicyGetRuleSchema", () => {
    it("accepts valid input", () => {
      const input = { ruleId: "rule_1" };
      const result = PolicyGetRuleSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        ruleId: "rule_1",
        sourceId: "policy_1",
        title: "Max Leverage Ratio",
        appliesWhen: "commercial loan",
        input: { metric: "debt_to_ebitda" },
        operator: "<=",
        threshold: 3.0,
        onFailure: "DECLINE",
        citationAnchors: [
          { sourceId: "policy_1", startOffset: 10, endOffset: 48 },
        ],
      };
      const result = PolicyGetRuleSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});

describe("Finance Tool Schemas", () => {
  describe("FinanceCalculateSchema", () => {
    it("accepts valid input", () => {
      const input = { expression: "a + b", variables: { a: 100, b: 200 } };
      const result = FinanceCalculateSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = { result: 300 };
      const result = FinanceCalculateSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("FinanceCalculateRatiosSchema", () => {
    it("accepts valid input", () => {
      const input = { spread: { revenue: 1000000, ebitda: 200000 } };
      const result = FinanceCalculateRatiosSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        ratios: { debt_to_ebitda: 2.5, interest_coverage: 4.0 },
      };
      const result =
        FinanceCalculateRatiosSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("FinanceValidateSpreadSchema", () => {
    it("accepts valid input", () => {
      const input = { spread: { revenue: 1000000, cogs: 600000 } };
      const result = FinanceValidateSpreadSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output with errors", () => {
      const output = { valid: false, errors: ["Revenue must be positive"] };
      const result = FinanceValidateSpreadSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("accepts valid output without errors", () => {
      const output = { valid: true };
      const result = FinanceValidateSpreadSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});

describe("Submission Tool Schemas", () => {
  describe("SubmissionSaveArtifactSchema", () => {
    it("accepts valid input", () => {
      const input = {
        artifactId: "artifact_1",
        content: "base64content...",
        contentType: "application/json",
      };
      const result = SubmissionSaveArtifactSchema.shape.input.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid output", () => {
      const output = {
        artifactId: "artifact_1",
        sourceId: "src_artifact_1",
        citationAnchors: [{ sourceId: "src_artifact_1" }],
      };
      const result =
        SubmissionSaveArtifactSchema.shape.output.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("rejects missing sourceId", () => {
      const output = {
        artifactId: "artifact_1",
        citationAnchors: [{ sourceId: "artifact_1" }],
      };
      const result =
        SubmissionSaveArtifactSchema.shape.output.safeParse(output);
      expect(result.success).toBe(false);
    });
  });
});

describe("Tool Registry", () => {
  it("contains exactly 12 tools", () => {
    expect(Object.keys(TOOL_SCHEMAS).length).toBe(12);
  });

  it("has all required case tools", () => {
    expect(TOOL_SCHEMAS["case.list_documents"]).toBeDefined();
    expect(TOOL_SCHEMAS["case.get_document_metadata"]).toBeDefined();
    expect(TOOL_SCHEMAS["case.read_document"]).toBeDefined();
    expect(TOOL_SCHEMAS["case.search_documents"]).toBeDefined();
    expect(TOOL_SCHEMAS["case.get_structured_record"]).toBeDefined();
    expect(TOOL_SCHEMAS["case.request_information"]).toBeDefined();
  });

  it("has all required policy tools", () => {
    expect(TOOL_SCHEMAS["policy.search"]).toBeDefined();
    expect(TOOL_SCHEMAS["policy.get_rule"]).toBeDefined();
  });

  it("has all required finance tools", () => {
    expect(TOOL_SCHEMAS["finance.calculate"]).toBeDefined();
    expect(TOOL_SCHEMAS["finance.calculate_ratios"]).toBeDefined();
    expect(TOOL_SCHEMAS["finance.validate_spread"]).toBeDefined();
  });

  it("has all required submission tools", () => {
    expect(TOOL_SCHEMAS["submission.save_artifact"]).toBeDefined();
  });

  it("each tool has input, output, and error schemas", () => {
    for (const [_name, schema] of Object.entries(TOOL_SCHEMAS)) {
      expect(schema.shape.input).toBeDefined();
      expect(schema.shape.output).toBeDefined();
      expect(schema.shape.error).toBeDefined();
    }
  });

  it("TOOL_NAMES includes all 12 tools", () => {
    expect(TOOL_NAMES.length).toBe(12);
    for (const name of TOOL_NAMES) {
      expect(isValidToolName(name)).toBe(true);
    }
  });

  it("TOOL_CATEGORIES covers all tools", () => {
    const allCategorized = Object.values(TOOL_CATEGORIES).flat();
    expect(allCategorized.length).toBe(12);
    for (const name of TOOL_NAMES) {
      expect(allCategorized).toContain(name);
    }
  });

  it("getToolCategory returns correct category", () => {
    expect(getToolCategory("case.read_document")).toBe("case");
    expect(getToolCategory("policy.search")).toBe("policy");
    expect(getToolCategory("finance.calculate")).toBe("finance");
    expect(getToolCategory("submission.save_artifact")).toBe("submission");
    expect(getToolCategory("unknown.tool")).toBeUndefined();
  });

  it("isValidToolName returns true for valid tools", () => {
    expect(isValidToolName("case.list_documents")).toBe(true);
    expect(isValidToolName("finance.calculate_ratios")).toBe(true);
  });

  it("isValidToolName returns false for invalid tools", () => {
    expect(isValidToolName("case.unknown")).toBe(false);
    expect(isValidToolName("unknown")).toBe(false);
  });
});

describe("Validation Helpers", () => {
  it("validateToolInput accepts valid arguments", () => {
    const result = validateToolInput("case.read_document", {
      documentId: "doc_1",
      pages: [1],
    });
    expect(result.success).toBe(true);
  });

  it("validateToolInput rejects invalid arguments", () => {
    const result = validateToolInput("case.read_document", {
      invalidField: "test",
    });
    expect(result.success).toBe(false);
  });

  it("validateToolInput rejects unknown tool", () => {
    const result = validateToolInput("unknown.tool", {});
    expect(result.success).toBe(false);
  });

  it("validateToolOutput accepts valid output", () => {
    const result = validateToolOutput("case.read_document", {
      documentId: "doc_1",
      sourceId: "source_1",
      content: "text",
      pages: [{ pageNumber: 1, text: "text", citationAnchor }],
    });
    expect(result.success).toBe(true);
  });

  it("validateToolError accepts valid error", () => {
    const result = validateToolError("case.read_document", {
      code: "NOT_FOUND",
      message: "Document not found",
    });
    expect(result.success).toBe(true);
  });
});

describe("Tool Name Exact Matching", () => {
  const expectedNames = [
    "case.list_documents",
    "case.get_document_metadata",
    "case.read_document",
    "case.search_documents",
    "case.get_structured_record",
    "case.request_information",
    "policy.search",
    "policy.get_rule",
    "finance.calculate",
    "finance.calculate_ratios",
    "finance.validate_spread",
    "submission.save_artifact",
  ];

  for (const name of expectedNames) {
    it(`includes exact tool name: ${name}`, () => {
      expect(TOOL_SCHEMAS).toHaveProperty(name);
    });
  }

  it("has no extra tool names beyond the 12 expected", () => {
    const actualNames = Object.keys(TOOL_SCHEMAS).sort();
    expect(actualNames).toEqual(expectedNames.sort());
  });
});
