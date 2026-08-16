import { describe, it, expect } from "vitest";
import {
  scoreWorkflow,
  createWorkflowScoreInput,
  verifyEventArray,
  analyzeDuplicateCalls,
  analyzeBudgetAdherence,
  analyzeCancellation,
  analyzePhaseProgression,
  assessToolChoice,
  assessInformationRequest,
  analyzeRecovery,
  DEFAULT_EXPECTED_PATTERNS,
} from "../index.js";
import type { Event } from "@uwbench/protocol";
import {
  successfulWorkflowEvents,
  incompleteWorkflowEvents,
  failedWorkflowEvents,
  gatewayErrorWorkflowEvents,
  infoRequestWorkflowEvents,
  duplicateWorkflowEvents,
  budgetWarningWorkflowEvents,
  cancelledWorkflowEvents,
  testBudgetLimits,
} from "../__fixtures__/events.js";

describe("Workflow Scorer", () => {
  describe("verifyEventArray", () => {
    it("should verify a valid event array", () => {
      const result = verifyEventArray(successfulWorkflowEvents);
      expect(result.valid).toBe(true);
      expect(result.events).toBeDefined();
      expect(result.chainVerified).toBe(true);
      expect(result.schemasValid).toBe(true);
      expect(result.eventCount).toBe(successfulWorkflowEvents.length);
    });

    it("should reject invalid event array", () => {
      const invalidEvents = [{ not: "an event" }];
      const result = verifyEventArray(invalidEvents);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("scoreWorkflow - successful workflow", () => {
    it("should produce a high score for a successful workflow", () => {
      const input = createWorkflowScoreInput(
        successfulWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.component).toBe("followup_and_workflow_behavior");
      expect(result.scorerVersion).toBe("0.1.0");
      expect(result.score).toBeGreaterThan(0.7); // Should score well
      expect(result.toolCallCount).toBeGreaterThan(0);
      expect(result.toolResultCount).toBe(result.toolCallCount); // Each call has a result
      expect(result.toolErrorCount).toBe(0);
      expect(result.artifactCount).toBe(1);
    });

    it("should have good tool choice quality", () => {
      const input = createWorkflowScoreInput(
        successfulWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.toolChoiceQuality).toBeGreaterThan(0.8);
      expect(result.phaseAppropriateRate).toBeGreaterThan(0.8);
      expect(result.antiPatternRate).toBeLessThan(0.2);
    });

    it("should have perfect budget adherence", () => {
      const input = createWorkflowScoreInput(
        successfulWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.budgetAdherence.hardLimitExceeded).toBe(false);
      expect(result.budgetAdherence.score).toBeGreaterThan(0.9);
    });

    it("should have no duplicates", () => {
      const input = createWorkflowScoreInput(
        successfulWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.duplicateCallAnalysis.totalDuplicateCalls).toBe(0);
      expect(result.duplicateCallAnalysis.score).toBe(1.0);
    });

    it("should not be cancelled", () => {
      const input = createWorkflowScoreInput(
        successfulWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.cancellationBehavior.wasCancelled).toBe(false);
      expect(result.cancellationBehavior.gracefulCompletion).toBe(true);
    });

    it("should have good phase progression", () => {
      const input = createWorkflowScoreInput(
        successfulWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.phaseProgressionScore).toBeGreaterThan(0.7);
      expect(result.phaseTransitions.length).toBeGreaterThan(0);
    });
  });

  describe("scoreWorkflow - incomplete workflow", () => {
    it("should produce a lower score for incomplete workflow", () => {
      const input = createWorkflowScoreInput(
        incompleteWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.score).toBeLessThan(0.98); // Slightly penalized for incomplete
      expect(result.toolCallCount).toBe(1);
      expect(result.cancellationBehavior.gracefulCompletion).toBe(false);
    });
  });

  describe("scoreWorkflow - gateway TOOL_ERROR payloads", () => {
    it("scores events that use code/resultBytes instead of error", () => {
      const input = createWorkflowScoreInput(
        gatewayErrorWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);
      expect(result.toolErrorCount).toBe(1);
      expect(result.recoveryBehavior.totalErrors).toBe(1);
    });
  });

  describe("scoreWorkflow - failed workflow", () => {
    it("should produce a low score for failed workflow with errors and no recovery", () => {
      const input = createWorkflowScoreInput(
        failedWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.score).toBeLessThan(0.85); // Penalized for errors and no recovery
      expect(result.toolErrorCount).toBe(2);
      expect(result.recoveryBehavior.totalErrors).toBe(2);
      expect(result.recoveryBehavior.recoveredErrors).toBe(0);
      expect(result.recoveryBehavior.score).toBeLessThan(0.5);
    });
  });

  describe("scoreWorkflow - information request behavior", () => {
    it("should assess information request quality", () => {
      const input = createWorkflowScoreInput(
        infoRequestWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.informationRequestCount).toBe(4);
      expect(result.informationRequestQuality).toBeGreaterThan(0);
      // One clarification followed up, one re-request
      expect(result.clarificationFollowUpRate).toBe(1.0); // 1 out of 1 followed up
      expect(result.reRequestRate).toBeGreaterThan(0); // 1 re-request out of 4
    });
  });

  describe("scoreWorkflow - duplicate detection", () => {
    it("should detect duplicate calls and penalize", () => {
      const input = createWorkflowScoreInput(
        duplicateWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.duplicateCallAnalysis.groups.length).toBe(1);
      expect(result.duplicateCallAnalysis.totalDuplicateCalls).toBe(2); // 3 calls, 2 duplicates
      expect(result.duplicateCallAnalysis.toolsWithDuplicates).toBe(1);
      expect(result.duplicateCallAnalysis.score).toBeLessThan(1.0);
      expect(result.duplicateCallAnalysis.score).toBeGreaterThan(0.7); // ~0.9^2 = 0.81
    });
  });

  describe("scoreWorkflow - budget warnings", () => {
    it("should penalize high budget utilization", () => {
      const input = createWorkflowScoreInput(
        budgetWarningWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.toolCallCount).toBe(90);
      expect(result.budgetAdherence.utilization.toolCalls).toBe(0.9);
      expect(result.budgetAdherence.warnings.length).toBe(1);
      expect(result.budgetAdherence.score).toBeLessThan(1.0);
    });
  });

  describe("scoreWorkflow - cancellation", () => {
    it("should handle graceful cancellation well", () => {
      const input = createWorkflowScoreInput(
        cancelledWorkflowEvents,
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      const result = scoreWorkflow(input);

      expect(result.cancellationBehavior.wasCancelled).toBe(true);
      expect(result.cancellationBehavior.gracefulCompletion).toBe(true);
      expect(result.cancellationBehavior.savedArtifactsBeforeCancel).toBe(true);
      expect(result.cancellationBehavior.score).toBeGreaterThan(0.7);
    });
  });

  describe("analyzeDuplicateCalls", () => {
    it("should find no duplicates in unique calls", () => {
      const calls = successfulWorkflowEvents.filter(
        (e) => e.type === "TOOL_CALL",
      ) as Event[];
      const result = analyzeDuplicateCalls(calls);
      expect(result.totalDuplicateCalls).toBe(0);
      expect(result.score).toBe(1.0);
    });

    it("should find duplicates in duplicate workflow", () => {
      const calls = duplicateWorkflowEvents.filter(
        (e) => e.type === "TOOL_CALL",
      ) as Event[];
      const result = analyzeDuplicateCalls(calls);
      expect(result.totalDuplicateCalls).toBe(2);
      expect(result.groups[0]?.toolName).toBe("case.read_document");
    });
  });

  describe("analyzeBudgetAdherence", () => {
    it("should calculate utilization correctly", () => {
      const result = analyzeBudgetAdherence(
        successfulWorkflowEvents,
        testBudgetLimits,
        [],
        successfulWorkflowEvents.find(
          (e) => e.type === "AGENT_COMPLETED",
        ) as Event | null,
      );

      expect(result.usage.toolCalls).toBe(6);
      expect(result.utilization.toolCalls).toBe(0.06);
      expect(result.hardLimitExceeded).toBe(false);
    });

    it("should detect hard limit exceeded", () => {
      const tightLimits = { ...testBudgetLimits, maxToolCalls: 5 };
      const result = analyzeBudgetAdherence(
        successfulWorkflowEvents,
        tightLimits,
        [],
        successfulWorkflowEvents.find(
          (e) => e.type === "AGENT_COMPLETED",
        ) as Event | null,
      );

      expect(result.hardLimitExceeded).toBe(true);
      expect(result.exceededLimits).toContain("maxToolCalls");
    });
  });

  describe("analyzeCancellation", () => {
    it("should detect non-cancelled run", () => {
      const runCancelled = successfulWorkflowEvents.find(
        (e) => e.type === "RUN_CANCELLED",
      ) as Event | null;
      const agentCompleted = successfulWorkflowEvents.find(
        (e) => e.type === "AGENT_COMPLETED",
      ) as Event | null;
      const artifacts = successfulWorkflowEvents.filter(
        (e) => e.type === "ARTIFACT_SAVED",
      );

      const result = analyzeCancellation(
        runCancelled,
        agentCompleted,
        successfulWorkflowEvents,
        artifacts,
      );

      expect(result.wasCancelled).toBe(false);
      expect(result.gracefulCompletion).toBe(true);
    });

    it("should detect cancelled run", () => {
      const runCancelled = cancelledWorkflowEvents.find(
        (e) => e.type === "RUN_CANCELLED",
      ) as Event | null;
      const agentCompleted = cancelledWorkflowEvents.find(
        (e) => e.type === "AGENT_COMPLETED",
      ) as Event | null;
      const artifacts = cancelledWorkflowEvents.filter(
        (e) => e.type === "ARTIFACT_SAVED",
      );

      const result = analyzeCancellation(
        runCancelled,
        agentCompleted,
        cancelledWorkflowEvents,
        artifacts,
      );

      expect(result.wasCancelled).toBe(true);
      expect(result.gracefulCompletion).toBe(true);
      expect(result.savedArtifactsBeforeCancel).toBe(true);
    });
  });

  describe("analyzePhaseProgression", () => {
    it("should detect phase transitions in successful workflow", () => {
      const calls = successfulWorkflowEvents.filter(
        (e) => e.type === "TOOL_CALL",
      ) as Event[];
      const { transitions, score } = analyzePhaseProgression(
        calls,
        DEFAULT_EXPECTED_PATTERNS,
      );

      expect(transitions.length).toBeGreaterThan(0);
      expect(score).toBeGreaterThan(0.5);
      // Should have forward progressions
      expect(transitions.some((t) => t.direction === "forward")).toBe(true);
    });
  });

  describe("assessToolChoice", () => {
    it("should assess tool choice quality", () => {
      const callEvent = successfulWorkflowEvents.find(
        (e) => e.type === "TOOL_CALL" && e.sequence === 4,
      ) as Event;
      const toolResults = successfulWorkflowEvents.filter(
        (e) => e.type === "TOOL_RESULT",
      ) as Event[];
      const toolErrors = successfulWorkflowEvents.filter(
        (e) => e.type === "TOOL_ERROR",
      ) as Event[];

      const assessment = assessToolChoice(
        callEvent as any,
        toolResults as any,
        toolErrors as any,
        "discovery",
        [],
        new Map(),
      );

      expect(assessment.qualityScore).toBeGreaterThan(0.8);
      expect(assessment.phaseAppropriate).toBe(true);
      expect(assessment.isAntiPattern).toBe(false);
      expect(assessment.isDuplicate).toBe(false);
    });
  });

  describe("assessInformationRequest", () => {
    it("should assess well-formed request", () => {
      const callEvent = infoRequestWorkflowEvents.find(
        (e) => e.type === "TOOL_CALL" && e.sequence === 4,
      ) as Event;
      const toolResults = infoRequestWorkflowEvents.filter(
        (e) => e.type === "TOOL_RESULT",
      ) as Event[];
      const toolErrors = infoRequestWorkflowEvents.filter(
        (e) => e.type === "TOOL_ERROR",
      ) as Event[];
      const allInfoRequests = infoRequestWorkflowEvents.filter(
        (e) =>
          e.type === "TOOL_CALL" &&
          e.payload.name === "case.request_information",
      ) as Event[];

      const assessment = assessInformationRequest(
        callEvent as any,
        toolResults as any,
        toolErrors as any,
        allInfoRequests as any,
      );

      expect(assessment.wellFormed).toBe(true);
      expect(assessment.resultStatus).toBe("AVAILABLE");
      expect(assessment.qualityScore).toBeGreaterThan(0.8);
    });

    it("should detect re-request of provided info", () => {
      const callEvent = infoRequestWorkflowEvents.find(
        (e) => e.type === "TOOL_CALL" && e.sequence === 10,
      ) as Event;
      const toolResults = infoRequestWorkflowEvents.filter(
        (e) => e.type === "TOOL_RESULT",
      ) as Event[];
      const toolErrors = infoRequestWorkflowEvents.filter(
        (e) => e.type === "TOOL_ERROR",
      ) as Event[];
      const allInfoRequests = infoRequestWorkflowEvents.filter(
        (e) =>
          e.type === "TOOL_CALL" &&
          e.payload.name === "case.request_information",
      ) as Event[];

      const assessment = assessInformationRequest(
        callEvent as any,
        toolResults as any,
        toolErrors as any,
        allInfoRequests as any,
      );

      expect(assessment.reRequestedProvided).toBe(true);
      expect(assessment.resultStatus).toBe("ALREADY_PROVIDED");
      expect(assessment.qualityScore).toBeLessThan(0.8);
    });
  });

  describe("analyzeRecovery", () => {
    it("should detect no recovery in failed workflow", () => {
      const toolErrors = failedWorkflowEvents.filter(
        (e) => e.type === "TOOL_ERROR",
      ) as Event[];
      const toolCalls = failedWorkflowEvents.filter(
        (e) => e.type === "TOOL_CALL",
      ) as Event[];
      const toolResults = failedWorkflowEvents.filter(
        (e) => e.type === "TOOL_RESULT",
      ) as Event[];

      const result = analyzeRecovery(
        toolErrors as any,
        toolCalls as any,
        toolResults as any,
        failedWorkflowEvents,
      );

      expect(result.totalErrors).toBe(2);
      expect(result.recoveredErrors).toBe(0);
      expect(result.unrecoveredErrors).toBe(2);
      expect(result.score).toBeLessThan(0.3);
    });
  });

  describe("scoreWorkflow - fail closed on malformed events", () => {
    it("should throw on malformed event stream", () => {
      // Create events that pass schema validation but fail hash chain
      const malformedEvents = [
        {
          schemaVersion: "1.0",
          eventId: "evt_1",
          runId: "run_test",
          caseId: "case_test",
          sequence: 1,
          timestamp: new Date().toISOString(),
          source: "RUNNER",
          type: "RUN_STARTED",
          payload: {},
          previousHash: "sha256:genesis",
          hash: "sha256:invalid_hash", // Wrong hash
        },
      ];
      const input = createWorkflowScoreInput(
        malformedEvents as Event[],
        "case_test",
        "run_test",
        testBudgetLimits,
      );

      expect(() => scoreWorkflow(input)).toThrow(
        "Event stream verification failed",
      );
    });
  });
});
