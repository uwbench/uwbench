import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as AgentSchemas from "./agent.js";
import * as CommonSchemas from "./common.js";
import * as EventSchemas from "./events.js";
import { RunStatusResponseSchema } from "./agent.js";
import {
  FinancialSpreadSchema,
  NonnegativeMoneySchema,
  UnderwritingSubmissionSchema,
} from "./submission.js";
import { ToolCallSchema, ToolResultSchema } from "./tools.js";
import * as SubmissionSchemas from "./submission.js";
import * as ToolSchemas from "./tools.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (
  ajv: InstanceType<typeof Ajv2020>,
) => InstanceType<typeof Ajv2020>;

interface JsonSchemaNode {
  title?: string;
  type?: string;
  format?: string;
  pattern?: string;
  const?: unknown;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  additionalProperties?: boolean | JsonSchemaNode;
  oneOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
}

const generatedRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "generated",
  "json-schema",
);

function generatedSchema(category: string, name: string): JsonSchemaNode {
  return JSON.parse(
    readFileSync(join(generatedRoot, category, `${name}.json`), "utf8"),
  ) as JsonSchemaNode;
}

function jsonValidator(category: string, name: string) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    useDefaults: true,
    validateFormats: true,
  });
  addFormats(ajv);
  return ajv.compile(generatedSchema(category, name));
}

function resolveReference(
  schema: JsonSchemaNode,
  root: JsonSchemaNode,
): JsonSchemaNode {
  if (!schema.$ref?.startsWith("#/$defs/")) return schema;
  return root.$defs?.[schema.$ref.slice("#/$defs/".length)] ?? schema;
}

function sampleFor(schema: JsonSchemaNode, root: JsonSchemaNode): unknown {
  const resolved = resolveReference(schema, root);
  if (resolved.const !== undefined) return structuredClone(resolved.const);
  if (resolved.enum?.length) return structuredClone(resolved.enum[0]);
  if (resolved.oneOf?.length) return sampleFor(resolved.oneOf[0]!, root);
  if (resolved.anyOf?.length) return sampleFor(resolved.anyOf[0]!, root);
  if (resolved.allOf?.length) {
    return Object.assign(
      {},
      ...resolved.allOf.map((item) => sampleFor(item, root)),
    );
  }

  if (resolved.type === "object" || resolved.properties) {
    const sample: Record<string, unknown> = {};
    for (const [property, propertySchema] of Object.entries(
      resolved.properties ?? {},
    )) {
      sample[property] = sampleFor(propertySchema, root);
    }
    return sample;
  }
  if (resolved.type === "array") {
    const length = resolved.minItems ?? 0;
    return Array.from({ length }, () => sampleFor(resolved.items ?? {}, root));
  }
  if (resolved.type === "string") {
    if (resolved.format === "date") return "2026-01-31";
    if (resolved.format === "date-time") return "2026-01-31T12:00:00Z";
    if (resolved.format === "uri") return "https://example.test/resource";
    return "a".repeat(Math.max(1, resolved.minLength ?? 0));
  }
  if (resolved.type === "integer" || resolved.type === "number") {
    if (resolved.exclusiveMinimum !== undefined) {
      return resolved.type === "integer"
        ? Math.floor(resolved.exclusiveMinimum) + 1
        : resolved.exclusiveMinimum + Number.EPSILON;
    }
    if (resolved.exclusiveMaximum !== undefined) {
      return resolved.type === "integer"
        ? Math.ceil(resolved.exclusiveMaximum) - 1
        : resolved.exclusiveMaximum - Number.EPSILON;
    }
    if (resolved.minimum !== undefined) return resolved.minimum;
    if (resolved.maximum !== undefined && resolved.maximum < 0) {
      return resolved.maximum;
    }
    return 0;
  }
  if (resolved.type === "boolean") return false;
  return null;
}

function rootSamples(schema: JsonSchemaNode): unknown[] {
  const variants = schema.oneOf ?? schema.anyOf;
  return variants?.length
    ? variants.map((variant) => sampleFor(variant, schema))
    : [sampleFor(schema, schema)];
}

function setAtPath(value: unknown, path: (string | number)[], next: unknown) {
  const clone = structuredClone(value);
  if (path.length === 0) return structuredClone(next);
  let cursor = clone as Record<string | number, unknown>;
  for (const segment of path.slice(0, -1)) {
    cursor = cursor[segment] as Record<string | number, unknown>;
  }
  cursor[path.at(-1)!] = structuredClone(next);
  return clone;
}

function deleteAtPath(value: unknown, path: (string | number)[]) {
  const clone = structuredClone(value);
  let cursor = clone as Record<string | number, unknown>;
  for (const segment of path.slice(0, -1)) {
    cursor = cursor[segment] as Record<string | number, unknown>;
  }
  delete cursor[path.at(-1)!];
  return clone;
}

function constraintMutations(
  schema: JsonSchemaNode,
  value: unknown,
  root: JsonSchemaNode,
  path: (string | number)[] = [],
): unknown[] {
  const resolved = resolveReference(schema, root);
  const mutations: unknown[] = [];
  const current = path.reduce(
    (cursor, segment) =>
      (cursor as Record<string | number, unknown> | undefined)?.[segment],
    value,
  );
  const variants = resolved.oneOf ?? resolved.anyOf;
  if (variants) {
    for (const variant of variants) {
      mutations.push(...constraintMutations(variant, value, root, path));
    }
    return mutations;
  }

  if (
    (resolved.type === "object" || resolved.properties) &&
    current !== null &&
    typeof current === "object" &&
    !Array.isArray(current)
  ) {
    mutations.push(
      setAtPath(value, path, {
        ...(current as Record<string, unknown>),
        __unexpected: true,
      }),
    );
    for (const required of resolved.required ?? []) {
      mutations.push(deleteAtPath(value, [...path, required]));
    }
    for (const [name, property] of Object.entries(resolved.properties ?? {})) {
      if (Object.hasOwn(current, name)) {
        mutations.push(
          ...constraintMutations(property, value, root, [...path, name]),
        );
      }
    }
  } else if (resolved.type === "array" && Array.isArray(current)) {
    if ((resolved.minItems ?? 0) > 0)
      mutations.push(setAtPath(value, path, []));
    if (current.length > 0 && resolved.items) {
      mutations.push(
        ...constraintMutations(resolved.items, value, root, [...path, 0]),
      );
    }
  } else if (resolved.type === "string") {
    if (resolved.const !== undefined || resolved.enum) {
      mutations.push(setAtPath(value, path, "__invalid_enum_value__"));
    }
    if (resolved.format || resolved.pattern) {
      mutations.push(setAtPath(value, path, "not-a-valid-format"));
    }
    if ((resolved.minLength ?? 0) > 0) {
      mutations.push(
        setAtPath(value, path, "a".repeat(resolved.minLength! - 1)),
      );
    }
    if (resolved.maxLength !== undefined) {
      mutations.push(
        setAtPath(value, path, "a".repeat(resolved.maxLength + 1)),
      );
    }
  } else if (resolved.type === "integer" || resolved.type === "number") {
    if (resolved.minimum !== undefined) {
      mutations.push(setAtPath(value, path, resolved.minimum - 1));
    }
    if (resolved.exclusiveMinimum !== undefined) {
      mutations.push(setAtPath(value, path, resolved.exclusiveMinimum));
    }
    if (resolved.maximum !== undefined) {
      mutations.push(setAtPath(value, path, resolved.maximum + 1));
    }
    if (resolved.exclusiveMaximum !== undefined) {
      mutations.push(setAtPath(value, path, resolved.exclusiveMaximum));
    }
    if (resolved.type === "integer") {
      mutations.push(setAtPath(value, path, 0.5));
    }
  }
  return mutations;
}

const schemaModules = [
  CommonSchemas,
  AgentSchemas,
  ToolSchemas,
  EventSchemas,
  SubmissionSchemas,
] as const;

function zodSchemaFor(name: string): z.ZodType {
  const exportName = `${name}Schema`;
  for (const module of schemaModules) {
    const candidate = (module as Record<string, unknown>)[exportName];
    if (
      candidate &&
      typeof candidate === "object" &&
      "safeParse" in candidate
    ) {
      return candidate as z.ZodType;
    }
  }
  throw new Error(`No exported Zod schema found for ${name}`);
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
  scale: "units",
  signConvention: "positive_revenue_negative_expense",
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
  it("keeps every generated wire schema and discovered constraint in parity", () => {
    const categories = readdirSync(generatedRoot);
    let schemaCount = 0;
    let mutationCount = 0;

    for (const category of categories) {
      for (const file of readdirSync(join(generatedRoot, category)).filter(
        (entry) => entry.endsWith(".json"),
      )) {
        const name = file.slice(0, -".json".length);
        const jsonSchema = generatedSchema(category, name);
        expect(
          JSON.stringify(jsonSchema),
          `${category}/${name} must not materialize language-specific defaults`,
        ).not.toContain('"default":');
        const zodSchema = zodSchemaFor(name);
        const validateJson = jsonValidator(category, name);
        schemaCount += 1;

        for (const sample of rootSamples(jsonSchema)) {
          const jsonValue = structuredClone(sample);
          const zodResult = zodSchema.safeParse(structuredClone(sample));
          const jsonValid = validateJson(jsonValue);
          expect(
            { zod: zodResult.success, json: jsonValid },
            `${category}/${name}: ${JSON.stringify(validateJson.errors)}`,
          ).toEqual({ zod: true, json: true });
          if (zodResult.success) {
            expect(
              jsonValue,
              `${category}/${name}: default materialization`,
            ).toEqual(zodResult.data);
          }

          const mutations = [
            ...new Map(
              constraintMutations(jsonSchema, sample, jsonSchema).map(
                (mutation) => [JSON.stringify(mutation), mutation],
              ),
            ).values(),
          ];
          mutationCount += mutations.length;
          for (const mutation of mutations) {
            const zodValid = zodSchema.safeParse(
              structuredClone(mutation),
            ).success;
            const jsonValidForMutation = validateJson(
              structuredClone(mutation),
            );
            expect(
              zodValid,
              `${category}/${name} mutation diverged: ${JSON.stringify(mutation)}; ${JSON.stringify(validateJson.errors)}`,
            ).toBe(jsonValidForMutation);
          }
        }
      }
    }

    expect(schemaCount).toBeGreaterThanOrEqual(73);
    expect(mutationCount).toBeGreaterThan(300);
  });

  it("asserts date, date-time, and URI formats in both validators", () => {
    expectParity(
      FinancialSpreadSchema,
      jsonValidator("submission", "FinancialSpread"),
      {
        ...minimalSpread,
        period: { start: "2025-02-30", end: "not-a-date" },
      },
      false,
    );
    expectParity(
      ToolCallSchema,
      jsonValidator("tools", "ToolCall"),
      {
        schemaVersion: "1.0",
        callId: "call_1",
        name: "case.list_documents",
        arguments: {},
      },
      true,
    );
    const runRequest = {
      schemaVersion: "1.0",
      benchmark: "commercial-credit",
      benchmarkVersion: "0.1.0",
      lane: "reasoning_only",
      caseId: "case_1",
      objective: "Underwrite",
      requiredOutputs: [],
      toolGateway: { url: "not a URI", bearerToken: "token" },
      limits: {
        wallClockSeconds: 1,
        maxToolCalls: 1,
        maxOutputBytes: 1,
        maxConcurrentToolCalls: 1,
      },
    };
    expectParity(
      AgentSchemas.RunRequestSchema,
      jsonValidator("agent", "RunRequest"),
      runRequest,
      false,
    );

    const event = {
      schemaVersion: "1.0",
      eventId: "event_1",
      runId: "run_1",
      caseId: "case_1",
      sequence: 1,
      timestamp: "not-a-date-time",
      source: "RUNNER",
      type: "RUN_STARTED",
      payload: {},
      previousHash: "sha256:genesis",
      hash: "sha256:value",
    };
    expectParity(
      EventSchemas.EventSchema,
      jsonValidator("events", "Event"),
      event,
      false,
    );
  });

  it("matches defaults, strict unknown-field handling, and numeric constraints", () => {
    const spreadJson = jsonValidator("submission", "FinancialSpread");
    const moneyJson = jsonValidator("submission", "NonnegativeMoney");

    expectParity(FinancialSpreadSchema, spreadJson, minimalSpread, true);
    const zodSpread = FinancialSpreadSchema.parse(
      structuredClone(minimalSpread),
    );
    const jsonSpread = structuredClone(minimalSpread);
    expect(spreadJson(jsonSpread)).toBe(true);
    expect(jsonSpread).toEqual(zodSpread);
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
      ["finance.calculate_ratios", { spread: minimalSpread }],
      ["finance.validate_spread", { spread: minimalSpread }],
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
        { sourceId: "record_1", record: {}, evidence: [] },
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
          evidence: [],
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
          evidence: [],
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
        error: {
          schemaVersion: "1.0",
          code: "DIVIDE_BY_ZERO",
          message: "Cannot divide by zero",
          requestId: "request_2",
        },
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
        error: {
          schemaVersion: "1.0",
          code: "AMBIGUOUS",
          message: "Both branches present",
          requestId: "request_3",
        },
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
