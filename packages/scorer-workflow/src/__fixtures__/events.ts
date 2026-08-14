/**
 * Test fixtures for workflow scorer with valid hash chains.
 * Covers successful, incomplete, and failed workflows.
 */

import { type Event } from "@uwbench/protocol";
import { computeHash } from "@uwbench/protocol";

// Helper to create a base event and compute its hash
function createEvent(
  overrides: Partial<Event> & { previousHash?: string },
): Event {
  const base: Event = {
    schemaVersion: "1.0",
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    runId: "run_test",
    caseId: "case_test",
    sequence: 1,
    timestamp: new Date().toISOString(),
    source: "RUNNER",
    type: "RUN_STARTED",
    payload: {},
    previousHash: "sha256:genesis",
    hash: "",
  };

  const merged = { ...base, ...overrides };
  const { hash: _hash, ...eventWithoutHash } = merged;
  const hash = computeHash(eventWithoutHash);
  return { ...merged, hash };
}

// ──────────────────────────────────────────────────────────────
// Build valid event chain
// ──────────────────────────────────────────────────────────────

function buildEventChain(
  eventTemplates: (Partial<Event> & { previousHash?: string })[],
): Event[] {
  const events: Event[] = [];
  let previousHash = "sha256:genesis";

  for (let i = 0; i < eventTemplates.length; i++) {
    const template = eventTemplates[i]!;
    const event = createEvent({
      ...template,
      sequence: i + 1,
      previousHash,
    });
    events.push(event);
    previousHash = event.hash;
  }

  return events;
}

// ──────────────────────────────────────────────────────────────
// Successful Workflow Fixture
// ──────────────────────────────────────────────────────────────

export const successfulWorkflowEvents: Event[] = buildEventChain([
  { type: "RUN_STARTED", source: "RUNNER" },
  { type: "AGENT_READY", source: "AGENT" },
  { type: "AGENT_RUN_STARTED", source: "AGENT" },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_001",
      name: "case.list_documents",
      arguments: {},
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_001",
      ok: true,
      name: "case.list_documents",
      result: {
        documents: [
          {
            documentId: "doc_1",
            sourceId: "src_1",
            title: "Financial Statement",
            mimeType: "application/pdf",
            pageCount: 10,
          },
          {
            documentId: "doc_2",
            sourceId: "src_1",
            title: "Tax Returns",
            mimeType: "application/pdf",
            pageCount: 5,
          },
        ],
      },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_002",
      name: "case.read_document",
      arguments: { documentId: "doc_1", pages: [1, 2, 3] },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_002",
      ok: true,
      name: "case.read_document",
      result: {
        documentId: "doc_1",
        sourceId: "src_1",
        content: "Financial statement content...",
        pages: [
          {
            pageNumber: 1,
            text: "Page 1",
            evidence: {
              sourceId: "src_1",
              documentId: "doc_1",
              page: 1,
              startOffset: 0,
              endOffset: 100,
            },
          },
        ],
      },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_003",
      name: "policy.search",
      arguments: { query: "DSCR minimum", limit: 5 },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_003",
      ok: true,
      name: "policy.search",
      result: {
        rules: [
          {
            ruleId: "rule_1",
            sourceId: "policy_1",
            title: "DSCR Requirement",
            snippet: "Minimum DSCR of 1.25x",
            evidence: [],
          },
        ],
      },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_004",
      name: "finance.calculate_ratios",
      arguments: {
        spread: {
          revenue: 10000000,
          ebitda: 2000000,
          debtService: 1500000,
          totalDebt: 8000000,
          currentAssets: 3000000,
          currentLiabilities: 1500000,
          totalAssets: 15000000,
          equity: 7000000,
        },
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_004",
      ok: true,
      name: "finance.calculate_ratios",
      result: { ratios: { dscr: 1.33, leverage: 4.0, currentRatio: 2.0 } },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_005",
      name: "finance.validate_spread",
      arguments: {
        spread: {
          revenue: 10000000,
          ebitda: 2000000,
          debtService: 1500000,
          totalDebt: 8000000,
          currentAssets: 3000000,
          currentLiabilities: 1500000,
          totalAssets: 15000000,
          equity: 7000000,
        },
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_005",
      ok: true,
      name: "finance.validate_spread",
      result: { valid: true, errors: [] },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_006",
      name: "submission.save_artifact",
      arguments: {
        artifactId: "submission_1",
        content: "{}",
        contentType: "application/json",
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_006",
      ok: true,
      name: "submission.save_artifact",
      result: {
        artifactId: "submission_1",
        sourceId: "submission_1",
        evidence: [],
      },
    },
  },
  // ARTIFACT_SAVED event for the submission
  {
    type: "ARTIFACT_SAVED",
    source: "TOOL_GATEWAY",
    payload: {
      artifactId: "submission_1",
      contentType: "application/json",
      sizeBytes: 1000,
    },
  },
  {
    type: "AGENT_COMPLETED",
    source: "AGENT",
    payload: { status: "completed", outputBytes: 5000 },
  },
  { type: "RUN_COMPLETED", source: "RUNNER" },
]);

// ──────────────────────────────────────────────────────────────
// Incomplete Workflow Fixture (no submission, early termination)
// ──────────────────────────────────────────────────────────────

export const incompleteWorkflowEvents: Event[] = buildEventChain([
  { type: "RUN_STARTED", source: "RUNNER" },
  { type: "AGENT_READY", source: "AGENT" },
  { type: "AGENT_RUN_STARTED", source: "AGENT" },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_101",
      name: "case.list_documents",
      arguments: {},
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_101",
      ok: true,
      name: "case.list_documents",
      result: { documents: [] },
    },
  },
  {
    type: "AGENT_COMPLETED",
    source: "AGENT",
    payload: { status: "failed", outputBytes: 1000 },
  },
  { type: "RUN_COMPLETED", source: "RUNNER" },
]);

// ──────────────────────────────────────────────────────────────
// Failed Workflow Fixture (tool errors, no recovery)
// ──────────────────────────────────────────────────────────────

export const failedWorkflowEvents: Event[] = buildEventChain([
  { type: "RUN_STARTED", source: "RUNNER" },
  { type: "AGENT_READY", source: "AGENT" },
  { type: "AGENT_RUN_STARTED", source: "AGENT" },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_201",
      name: "case.read_document",
      arguments: { documentId: "nonexistent", pages: [1] },
    },
  },
  {
    type: "TOOL_ERROR",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_201",
      name: "case.read_document",
      error: { code: "NOT_FOUND", message: "Document not found", details: {} },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_202",
      name: "policy.get_rule",
      arguments: { ruleId: "invalid_rule" },
    },
  },
  {
    type: "TOOL_ERROR",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_202",
      name: "policy.get_rule",
      error: { code: "NOT_FOUND", message: "Rule not found", details: {} },
    },
  },
  // No recovery - just fails
  {
    type: "AGENT_COMPLETED",
    source: "AGENT",
    payload: { status: "failed", outputBytes: 500 },
  },
  { type: "RUN_COMPLETED", source: "RUNNER" },
]);

// ──────────────────────────────────────────────────────────────
// Workflow with Information Requests Fixture
// ──────────────────────────────────────────────────────────────

export const infoRequestWorkflowEvents: Event[] = buildEventChain([
  { type: "RUN_STARTED", source: "RUNNER" },
  { type: "AGENT_READY", source: "AGENT" },
  { type: "AGENT_RUN_STARTED", source: "AGENT" },
  // Well-formed information request - AVAILABLE
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_301",
      name: "case.request_information",
      arguments: {
        requested_concepts: ["cash_flow_projection"],
        question: "What are the projected cash flows for the next 12 months?",
        context: "Need for DSCR calculation",
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_301",
      ok: true,
      name: "case.request_information",
      result: { status: "AVAILABLE", revealedDocumentIds: ["doc_projection"] },
    },
  },
  // Information request needing clarification - followed up with SAME concept
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_302",
      name: "case.request_information",
      arguments: {
        requested_concepts: ["management_background"],
        question: "Tell me about management background",
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_302",
      ok: true,
      name: "case.request_information",
      result: {
        status: "NEEDS_CLARIFICATION",
        clarification: "Please specify which aspect of management background",
      },
    },
  },
  // Follow-up on clarification - uses same concept
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_303",
      name: "case.request_information",
      arguments: {
        requested_concepts: ["management_background"],
        question: "What is the management team's background in this industry?",
        context: "Clarification on management background",
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_303",
      ok: true,
      name: "case.request_information",
      result: { status: "AVAILABLE", revealedDocumentIds: ["doc_mgmt"] },
    },
  },
  // Duplicate information request (re-requesting provided info)
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_304",
      name: "case.request_information",
      arguments: {
        requested_concepts: ["cash_flow_projection"],
        question: "Can you provide cash flow projections again?",
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_304",
      ok: true,
      name: "case.request_information",
      result: { status: "ALREADY_PROVIDED" },
    },
  },
  {
    type: "AGENT_COMPLETED",
    source: "AGENT",
    payload: { status: "completed", outputBytes: 3000 },
  },
  { type: "RUN_COMPLETED", source: "RUNNER" },
]);

// ──────────────────────────────────────────────────────────────
// Workflow with Duplicates Fixture
// ──────────────────────────────────────────────────────────────

export const duplicateWorkflowEvents: Event[] = buildEventChain([
  { type: "RUN_STARTED", source: "RUNNER" },
  { type: "AGENT_READY", source: "AGENT" },
  { type: "AGENT_RUN_STARTED", source: "AGENT" },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_401",
      name: "case.read_document",
      arguments: { documentId: "doc_1", pages: [1] },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_401",
      ok: true,
      name: "case.read_document",
      result: {
        documentId: "doc_1",
        sourceId: "src_1",
        content: "Content",
        pages: [],
      },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_402",
      name: "case.read_document",
      arguments: { documentId: "doc_1", pages: [1] },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_402",
      ok: true,
      name: "case.read_document",
      result: {
        documentId: "doc_1",
        sourceId: "src_1",
        content: "Content",
        pages: [],
      },
    },
  },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_403",
      name: "case.read_document",
      arguments: { documentId: "doc_1", pages: [1] },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_403",
      ok: true,
      name: "case.read_document",
      result: {
        documentId: "doc_1",
        sourceId: "src_1",
        content: "Content",
        pages: [],
      },
    },
  },
  {
    type: "AGENT_COMPLETED",
    source: "AGENT",
    payload: { status: "completed", outputBytes: 2000 },
  },
  { type: "RUN_COMPLETED", source: "RUNNER" },
]);

// ──────────────────────────────────────────────────────────────
// Workflow with Budget Limit Warnings Fixture
// ──────────────────────────────────────────────────────────────

function createBudgetWarningEvents(): Event[] {
  const templates: (Partial<Event> & { previousHash?: string })[] = [
    { type: "RUN_STARTED", source: "RUNNER" },
    { type: "AGENT_READY", source: "AGENT" },
    { type: "AGENT_RUN_STARTED", source: "AGENT" },
  ];

  // Add 90 tool call/result pairs
  for (let i = 0; i < 90; i++) {
    templates.push({
      type: "TOOL_CALL",
      source: "AGENT",
      payload: {
        callId: `call_5${String(i).padStart(2, "0")}`,
        name: "finance.calculate",
        arguments: { expression: "1+1", variables: {} },
      },
    });
    templates.push({
      type: "TOOL_RESULT",
      source: "TOOL_GATEWAY",
      payload: {
        callId: `call_5${String(i).padStart(2, "0")}`,
        ok: true,
        name: "finance.calculate",
        result: { result: 2 },
      },
    });
  }

  templates.push({
    type: "LIMIT_WARNING",
    source: "RUNNER",
    payload: {
      limitType: "maxToolCalls",
      currentValue: 90,
      limitValue: 100,
      percentage: 0.9,
    },
  });
  templates.push({
    type: "AGENT_COMPLETED",
    source: "AGENT",
    payload: { status: "completed", outputBytes: 10000 },
  });
  templates.push({ type: "RUN_COMPLETED", source: "RUNNER" });

  return buildEventChain(templates);
}

export const budgetWarningWorkflowEvents: Event[] = createBudgetWarningEvents();

// ──────────────────────────────────────────────────────────────
// Workflow with Cancellation Fixture
// ──────────────────────────────────────────────────────────────

// Agent completes BEFORE cancellation (graceful)
export const cancelledWorkflowEvents: Event[] = buildEventChain([
  { type: "RUN_STARTED", source: "RUNNER" },
  { type: "AGENT_READY", source: "AGENT" },
  { type: "AGENT_RUN_STARTED", source: "AGENT" },
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_701",
      name: "case.read_document",
      arguments: { documentId: "doc_1" },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_701",
      ok: true,
      name: "case.read_document",
      result: {
        documentId: "doc_1",
        sourceId: "src_1",
        content: "Content",
        pages: [],
      },
    },
  },
  // Save artifact before completion
  {
    type: "TOOL_CALL",
    source: "AGENT",
    payload: {
      callId: "call_702",
      name: "submission.save_artifact",
      arguments: {
        artifactId: "partial",
        content: "{}",
        contentType: "application/json",
      },
    },
  },
  {
    type: "TOOL_RESULT",
    source: "TOOL_GATEWAY",
    payload: {
      callId: "call_702",
      ok: true,
      name: "submission.save_artifact",
      result: { artifactId: "partial", sourceId: "partial", evidence: [] },
    },
  },
  {
    type: "ARTIFACT_SAVED",
    source: "TOOL_GATEWAY",
    payload: {
      artifactId: "partial",
      contentType: "application/json",
      sizeBytes: 500,
    },
  },
  // Agent completes first (sequence 8)
  {
    type: "AGENT_COMPLETED",
    source: "AGENT",
    payload: { status: "completed", outputBytes: 5000 },
  },
  // Then cancellation (sequence 9)
  {
    type: "RUN_CANCELLED",
    source: "RUNNER",
    payload: { reason: "User requested cancellation", requestedBy: "USER" },
  },
  { type: "RUN_COMPLETED", source: "RUNNER" },
]);

// ──────────────────────────────────────────────────────────────
// Budget Limits for Testing
// ──────────────────────────────────────────────────────────────

export const testBudgetLimits = {
  wallClockSeconds: 900,
  maxToolCalls: 100,
  maxOutputBytes: 5_000_000,
  maxConcurrentToolCalls: 4,
};
