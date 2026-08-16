import { describe, it, expect } from "vitest";
import {
  RunRequestSchema,
  RunStatusSchema,
  RunResponseSchema,
  RunStatusResponseSchema,
  CancelResponseSchema,
  HealthResponseSchema,
  ProtocolErrorSchema,
  PROTOCOL_ERROR_CODES,
} from "../agent.js";
import type {
  RunRequest,
  RunStatus,
  RunResponse,
  RunStatusResponse,
  CancelResponse,
  ProtocolError,
} from "../agent.js";
import { UnderwritingSubmissionSchema } from "../submission.js";

describe("Agent Protocol Schemas", () => {
  describe("RunRequestSchema", () => {
    const validRequest: RunRequest = {
      schemaVersion: "1.0",
      benchmark: "commercial-credit",
      benchmarkVersion: "0.1.0",
      lane: "reasoning_only",
      caseId: "opaque_7f3e",
      objective: "Underwrite the applicant under the supplied credit policy.",
      requiredOutputs: [
        "financial_spread",
        "risks",
        "follow_up_requests",
        "policy_assessment",
        "recommendation",
        "credit_memo",
      ],
      toolGateway: {
        url: "http://127.0.0.1:8080/v1/tools/call",
        bearerToken: "run-scoped-token",
      },
      limits: {
        wallClockSeconds: 900,
        maxToolCalls: 100,
        maxOutputBytes: 5000000,
        maxConcurrentToolCalls: 4,
      },
    };

    it("accepts a valid run request", () => {
      const result = RunRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it("rejects unknown schemaVersion", () => {
      const result = RunRequestSchema.safeParse({
        ...validRequest,
        schemaVersion: "2.0",
      });
      expect(result.success).toBe(false);
      if (!result.success && result.error.issues[0]) {
        expect(result.error.issues[0].path).toContain("schemaVersion");
      }
    });

    it("rejects invalid lane", () => {
      const result = RunRequestSchema.safeParse({
        ...validRequest,
        lane: "invalid_lane" as RunRequest["lane"],
      });
      expect(result.success).toBe(false);
    });

    it("accepts all valid lanes", () => {
      const lanes: RunRequest["lane"][] = [
        "raw_documents",
        "normalized_data",
        "reasoning_only",
      ];
      for (const lane of lanes) {
        const result = RunRequestSchema.safeParse({ ...validRequest, lane });
        expect(result.success).toBe(true);
      }
    });

    it("rejects missing required fields", () => {
      const result = RunRequestSchema.safeParse({
        ...validRequest,
        benchmark: undefined as unknown as string,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid toolGateway URL", () => {
      const result = RunRequestSchema.safeParse({
        ...validRequest,
        toolGateway: { url: "not-a-url", bearerToken: "token" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive limits", () => {
      const result = RunRequestSchema.safeParse({
        ...validRequest,
        limits: {
          wallClockSeconds: 0,
          maxToolCalls: 100,
          maxOutputBytes: 5000000,
          maxConcurrentToolCalls: 4,
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RunStatusSchema", () => {
    it("accepts all valid statuses", () => {
      const statuses: RunStatus[] = [
        "accepted",
        "running",
        "awaiting_tool",
        "completed",
        "failed",
        "cancelled",
      ];
      for (const status of statuses) {
        const result = RunStatusSchema.safeParse(status);
        expect(result.success).toBe(true);
        expect(result.data).toBe(status);
      }
    });

    it("rejects unknown status", () => {
      const result = RunStatusSchema.safeParse("unknown" as RunStatus);
      expect(result.success).toBe(false);
    });
  });

  describe("RunResponseSchema", () => {
    it("accepts valid run response", () => {
      const response: RunResponse = {
        schemaVersion: "1.0",
        agentRunId: "run_123",
        status: "accepted",
      };
      const result = RunResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("rejects invalid status", () => {
      const result = RunResponseSchema.safeParse({
        schemaVersion: "1.0",
        agentRunId: "run_123",
        status: "invalid" as RunStatus,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RunStatusResponseSchema", () => {
    const validSubmission = UnderwritingSubmissionSchema.parse({
      schemaVersion: "1.0",
      financialSpread: {
        revenue: { amount: 1000000, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "positive_revenue_negative_expense",
      },
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
    });

    it("accepts completed response with result", () => {
      const response: RunStatusResponse = {
        schemaVersion: "1.0",
        agentRunId: "run_123",
        status: "completed",
        result: validSubmission,
      };
      const result = RunStatusResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("accepts failed response with error", () => {
      const response: RunStatusResponse = {
        schemaVersion: "1.0",
        agentRunId: "run_123",
        status: "failed",
        error: {
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: "Agent crashed",
          requestId: "request_123",
        },
      };
      const result = RunStatusResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("accepts active response without terminal payload", () => {
      const response: RunStatusResponse = {
        schemaVersion: "1.0",
        agentRunId: "run_123",
        status: "running",
      };
      const result = RunStatusResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("rejects completed response without result", () => {
      expect(
        RunStatusResponseSchema.safeParse({
          schemaVersion: "1.0",
          agentRunId: "run_123",
          status: "completed",
        }).success,
      ).toBe(false);
    });

    it("rejects failed response without a protocol error", () => {
      expect(
        RunStatusResponseSchema.safeParse({
          schemaVersion: "1.0",
          agentRunId: "run_123",
          status: "failed",
        }).success,
      ).toBe(false);
    });
  });

  describe("CancelResponseSchema", () => {
    it("accepts valid cancel response", () => {
      const response: CancelResponse = {
        schemaVersion: "1.0",
        agentRunId: "run_123",
        cancelled: true,
      };
      const result = CancelResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe("HealthResponseSchema", () => {
    it("accepts valid health response", () => {
      const response = {
        schemaVersion: "1.0",
        status: "ok" as const,
        version: "1.0.0",
        protocolVersion: "1.0",
      };
      const result = HealthResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("accepts a participant identity", () => {
      const result = HealthResponseSchema.safeParse({
        schemaVersion: "1.0",
        status: "ok",
        version: "1.0.0",
        protocolVersion: "1.0",
        participant: {
          harness: "securelend-underwriting-agent",
          harnessVersion: "0.1.0",
          model: "claude-sonnet-4-6",
          modelVersion: "2026-02-19",
          provider: "anthropic",
          providerVersion: "undeclared",
          adapter: "@uwbench/securelend-adapter",
          adapterVersion: "0.1.0",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-ok status", () => {
      const result = HealthResponseSchema.safeParse({
        schemaVersion: "1.0",
        status: "error",
        version: "1.0.0",
        protocolVersion: "1.0",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ProtocolErrorSchema", () => {
    it("accepts all valid error codes", () => {
      for (const code of PROTOCOL_ERROR_CODES) {
        const error: ProtocolError = {
          schemaVersion: "1.0",
          code,
          message: "Test error",
          requestId: "request_123",
        };
        const result = ProtocolErrorSchema.safeParse(error);
        expect(result.success).toBe(true);
      }
    });

    it("rejects unknown error code", () => {
      const result = ProtocolErrorSchema.safeParse({
        schemaVersion: "1.0",
        code: "UNKNOWN_ERROR",
        message: "Test error",
        requestId: "request_123",
      });
      expect(result.success).toBe(false);
    });

    it("accepts optional details", () => {
      const error: ProtocolError = {
        schemaVersion: "1.0",
        code: "INVALID_SUBMISSION",
        message: "Invalid request",
        details: { field: "lane", issue: "invalid value" },
        requestId: "request_123",
      };
      const result = ProtocolErrorSchema.safeParse(error);
      expect(result.success).toBe(true);
    });
  });

  describe("ProtocolErrorCodes completeness", () => {
    it("includes all required stable codes", () => {
      const requiredCodes = [
        "INVALID_SCHEMA_VERSION",
        "UNKNOWN_BENCHMARK",
        "LANE_NOT_SUPPORTED",
        "CASE_NOT_FOUND",
        "BUDGET_EXCEEDED",
        "TOOL_ERROR",
        "AGENT_TIMEOUT",
        "AGENT_CRASHED",
        "INVALID_SUBMISSION",
        "RUN_NOT_FOUND",
        "INVALID_RUN_STATE",
      ];
      for (const code of requiredCodes) {
        expect(PROTOCOL_ERROR_CODES).toContain(code);
      }
    });
  });
});
