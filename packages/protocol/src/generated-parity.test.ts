import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { RunStatusResponseSchema } from "./agent.js";
import {
  FinancialSpreadSchema,
  NonnegativeMoneySchema,
  UnderwritingSubmissionSchema,
} from "./submission.js";
import { ToolCallSchema, ToolResultSchema } from "./tools.js";

const generatedRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "generated",
  "json-schema",
);

function generatedSchema(category: string, name: string): object {
  return JSON.parse(
    readFileSync(join(generatedRoot, category, `${name}.json`), "utf8"),
  ) as object;
}

function jsonValidator(category: string, name: string) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  return ajv.compile(generatedSchema(category, name));
}

function expectParity(
  zodSchema: z.ZodType,
  validateJson: ReturnType<typeof jsonValidator>,
  value: unknown,
  expected: boolean,
): void {
  const zodValid = zodSchema.safeParse(value).success;
  const jsonValid = validateJson(value);
  expect({ zodValid, jsonValid }, JSON.stringify(validateJson.errors)).toEqual({
    zodValid: expected,
    jsonValid: expected,
  });
}

const minimalSpread = {
  revenue: { amount: 1_000_000, currency: "USD" },
  cogs: { amount: -600_000, currency: "USD" },
  period: { start: "2025-01-01", end: "2025-12-31" },
  currency: "USD",
};

const minimalSubmission = {
  schemaVersion: "1.0",
  financialSpread: minimalSpread,
  normalizedFacts: [],
  risks: [],
  discrepancies: [],
  complianceFindings: [],
  followUpRequests: [],
  policyAssessment: { applicableRules: [], evaluations: [] },
  recommendation: {
    decision: "APPROVE",
    confidence: 0.9,
    conditions: [],
    policyExceptions: [],
    rationale: [],
  },
  memo: { markdown: "", claims: [] },
  confidence: { overall: 0.9, byComponent: {} },
};

describe("Zod and generated JSON Schema parity", () => {
  it("matches defaults, strict unknown-field handling, and numeric constraints", () => {
    const spreadJson = jsonValidator("submission", "FinancialSpread");
    const moneyJson = jsonValidator("submission", "NonnegativeMoney");

    expectParity(FinancialSpreadSchema, spreadJson, minimalSpread, true);
    expectParity(
      FinancialSpreadSchema,
      spreadJson,
      { ...minimalSpread, unexpected: true },
      false,
    );
    expectParity(
      NonnegativeMoneySchema,
      moneyJson,
      { amount: 100, currency: "USD" },
      true,
    );
    expectParity(
      NonnegativeMoneySchema,
      moneyJson,
      { amount: -1, currency: "USD" },
      false,
    );
  });

  it("validates all twelve ToolCall discriminator variants identically", () => {
    const validateJson = jsonValidator("tools", "ToolCall");
    const calls = [
      ["case.list_documents", {}],
      ["case.get_document_metadata", { documentId: "doc_1" }],
      ["case.read_document", { documentId: "doc_1", pages: [1] }],
      ["case.search_documents", { query: "revenue" }],
      ["case.get_structured_record", { recordId: "record_1" }],
      [
        "case.request_information",
        { concept: "tax_returns", question: "Provide 2025 tax returns" },
      ],
      ["policy.search", { query: "DSCR" }],
      ["policy.get_rule", { ruleId: "DSCR_MINIMUM" }],
      ["finance.calculate", { expression: "a / b", variables: { a: 2, b: 1 } }],
      ["finance.calculate_ratios", { spread: {} }],
      ["finance.validate_spread", { spread: {} }],
      [
        "submission.save_artifact",
        {
          artifactId: "memo",
          content: "# Credit memo",
          contentType: "text/markdown",
        },
      ],
    ] as const;

    for (const [name, arguments_] of calls) {
      expectParity(
        ToolCallSchema,
        validateJson,
        {
          schemaVersion: "1.0",
          callId: `call_${name}`,
          name,
          arguments: arguments_,
        },
        true,
      );
    }

    expectParity(
      ToolCallSchema,
      validateJson,
      {
        schemaVersion: "1.0",
        callId: "call_wrong",
        name: "case.read_document",
        arguments: { query: "wrong schema" },
      },
      false,
    );
    expectParity(
      ToolCallSchema,
      validateJson,
      {
        callId: "call_unversioned",
        name: "case.list_documents",
        arguments: {},
      },
      false,
    );
  });

  it("matches every run-status and tool-result envelope branch", () => {
    const runStatusJson = jsonValidator("agent", "RunStatusResponse");
    const toolResultJson = jsonValidator("tools", "ToolResult");
    const statuses = [
      { schemaVersion: "1.0", agentRunId: "run_1", status: "running" },
      {
        schemaVersion: "1.0",
        agentRunId: "run_1",
        status: "completed",
        result: minimalSubmission,
      },
      {
        schemaVersion: "1.0",
        agentRunId: "run_1",
        status: "failed",
        error: {
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: "crashed",
          requestId: "request_1",
        },
      },
      { schemaVersion: "1.0", agentRunId: "run_1", status: "cancelled" },
    ];

    for (const status of statuses) {
      expectParity(RunStatusResponseSchema, runStatusJson, status, true);
    }

    const successfulResults = [
      ["case.list_documents", { documents: [] }],
      [
        "case.get_document_metadata",
        {
          documentId: "doc_1",
          sourceId: "source_1",
          title: "Financials",
          mimeType: "application/pdf",
          pageCount: 1,
          sizeBytes: 100,
          sha256: "a".repeat(64),
        },
      ],
      [
        "case.read_document",
        {
          documentId: "doc_1",
          sourceId: "source_1",
          content: "Revenue",
          pages: [],
        },
      ],
      ["case.search_documents", { results: [] }],
      [
        "case.get_structured_record",
        { sourceId: "record_1", record: {}, citationAnchors: [] },
      ],
      ["case.request_information", { status: "ALREADY_PROVIDED" }],
      ["policy.search", { rules: [] }],
      [
        "policy.get_rule",
        {
          ruleId: "DSCR_MINIMUM",
          sourceId: "policy_1",
          title: "Minimum DSCR",
          appliesWhen: "term loan",
          input: {},
          operator: ">=",
          threshold: 1.25,
          onFailure: "REFER",
          citationAnchors: [],
        },
      ],
      ["finance.calculate", { result: 2 }],
      ["finance.calculate_ratios", { ratios: {} }],
      ["finance.validate_spread", { valid: true }],
      [
        "submission.save_artifact",
        {
          artifactId: "memo",
          sourceId: "artifact_memo",
          citationAnchors: [],
        },
      ],
    ] as const;

    for (const [name, result] of successfulResults) {
      expectParity(
        ToolResultSchema,
        toolResultJson,
        {
          schemaVersion: "1.0",
          callId: `call_${name}`,
          ok: true,
          name,
          result,
        },
        true,
      );
    }
    expectParity(
      ToolResultSchema,
      toolResultJson,
      {
        schemaVersion: "1.0",
        callId: "call_2",
        ok: false,
        name: "finance.calculate",
        error: { code: "DIVIDE_BY_ZERO", message: "Cannot divide by zero" },
      },
      true,
    );
    expectParity(
      ToolResultSchema,
      toolResultJson,
      {
        schemaVersion: "1.0",
        callId: "call_3",
        ok: true,
        name: "finance.calculate",
        result: { result: 2 },
        error: { code: "AMBIGUOUS", message: "Both branches present" },
      },
      false,
    );
  });

  it("keeps the complete submission contract in parity", () => {
    expectParity(
      UnderwritingSubmissionSchema,
      jsonValidator("submission", "UnderwritingSubmission"),
      minimalSubmission,
      true,
    );
  });
});
