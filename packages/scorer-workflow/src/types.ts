import { z } from "zod";
import { EventSchema } from "@uwbench/protocol";

/**
 * Workflow Scorer Contracts
 *
 * Scores tool choice quality, information request behavior, recovery,
 * cancellation, budget adherence, and duplicate-call behavior from
 * trusted event logs.
 *
 * Key principles from SPEC:
 * - Follow-up and workflow behavior: 5% weight, deterministic event analysis
 * - Malformed or unverifiable event streams fail closed
 * - Deterministic fixtures cover successful, incomplete, and failed workflows
 */

// ──────────────────────────────────────────────────────────────
// Scorer Version
// ──────────────────────────────────────────────────────────────

export const WORKFLOW_SCORER_VERSION = "0.1.0" as const;

export const WorkflowScorerVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export type WorkflowScorerVersion = z.infer<typeof WorkflowScorerVersionSchema>;

// ──────────────────────────────────────────────────────────────
// Event Payload Types (mirroring protocol TOOL_CALL, TOOL_RESULT, etc.)
// ──────────────────────────────────────────────────────────────

/**
 * TOOL_CALL event payload
 */
export const ToolCallPayloadSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCallPayload = z.infer<typeof ToolCallPayloadSchema>;

/**
 * TOOL_RESULT event payload
 */
export const ToolResultPayloadSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  ok: z.boolean().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.record(z.string(), z.unknown()).optional(),
  resultBytes: z.number().int().nonnegative().optional(),
});
export type ToolResultPayload = z.infer<typeof ToolResultPayloadSchema>;

/**
 * TOOL_ERROR event payload.
 * The gateway emits `{ callId, name, code, resultBytes }`; fixtures may use `error`.
 */
export const ToolErrorPayloadSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  error: z.record(z.string(), z.unknown()).optional(),
  code: z.string().optional(),
  resultBytes: z.number().int().nonnegative().optional(),
});
export type ToolErrorPayload = z.infer<typeof ToolErrorPayloadSchema>;

/**
 * LIMIT_WARNING event payload
 */
export const LimitWarningPayloadSchema = z.strictObject({
  limitType: z.enum([
    "wallClockSeconds",
    "maxToolCalls",
    "maxOutputBytes",
    "maxConcurrentToolCalls",
  ]),
  currentValue: z.number(),
  limitValue: z.number(),
  percentage: z.number(),
});
export type LimitWarningPayload = z.infer<typeof LimitWarningPayloadSchema>;

/**
 * ARTIFACT_SAVED event payload
 */
export const ArtifactSavedPayloadSchema = z.strictObject({
  artifactId: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export type ArtifactSavedPayload = z.infer<typeof ArtifactSavedPayloadSchema>;

/**
 * RUN_CANCELLED event payload
 */
export const RunCancelledPayloadSchema = z.strictObject({
  reason: z.string().optional(),
  requestedBy: z.enum(["AGENT", "RUNNER", "USER"]).optional(),
});
export type RunCancelledPayload = z.infer<typeof RunCancelledPayloadSchema>;

/**
 * AGENT_COMPLETED event payload
 */
export const AgentCompletedPayloadSchema = z.strictObject({
  status: z.enum(["completed", "failed"]),
  outputBytes: z.number().int().nonnegative().optional(),
});
export type AgentCompletedPayload = z.infer<typeof AgentCompletedPayloadSchema>;

// ──────────────────────────────────────────────────────────────
// Typed Event Unions for Analysis
// ──────────────────────────────────────────────────────────────

export const ToolCallEventSchema = EventSchema.extend({
  type: z.literal("TOOL_CALL"),
  payload: ToolCallPayloadSchema,
});
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;

export const ToolResultEventSchema = EventSchema.extend({
  type: z.literal("TOOL_RESULT"),
  payload: ToolResultPayloadSchema,
});
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

export const ToolErrorEventSchema = EventSchema.extend({
  type: z.literal("TOOL_ERROR"),
  payload: ToolErrorPayloadSchema,
});
export type ToolErrorEvent = z.infer<typeof ToolErrorEventSchema>;

export const LimitWarningEventSchema = EventSchema.extend({
  type: z.literal("LIMIT_WARNING"),
  payload: LimitWarningPayloadSchema,
});
export type LimitWarningEvent = z.infer<typeof LimitWarningEventSchema>;

export const ArtifactSavedEventSchema = EventSchema.extend({
  type: z.literal("ARTIFACT_SAVED"),
  payload: ArtifactSavedPayloadSchema,
});
export type ArtifactSavedEvent = z.infer<typeof ArtifactSavedEventSchema>;

export const RunCancelledEventSchema = EventSchema.extend({
  type: z.literal("RUN_CANCELLED"),
  payload: RunCancelledPayloadSchema,
});
export type RunCancelledEvent = z.infer<typeof RunCancelledEventSchema>;

export const AgentCompletedEventSchema = EventSchema.extend({
  type: z.literal("AGENT_COMPLETED"),
  payload: AgentCompletedPayloadSchema,
});
export type AgentCompletedEvent = z.infer<typeof AgentCompletedEventSchema>;

// ──────────────────────────────────────────────────────────────
// Tool Choice Quality
// ──────────────────────────────────────────────────────────────

/**
 * Tool category classification for choice quality analysis.
 */
export const ToolCategorySchema = z.enum([
  "case", // case.list_documents, case.read_document, case.search_documents, case.get_document_metadata, case.get_structured_record
  "policy", // policy.search, policy.get_rule
  "finance", // finance.calculate, finance.calculate_ratios, finance.validate_spread
  "submission", // submission.save_artifact
  "information_request", // case.request_information
  "unknown",
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

/**
 * Expected tool usage pattern for a workflow phase.
 */
export const ExpectedToolPatternSchema = z.strictObject({
  /** Phase name (e.g., "discovery", "analysis", "validation", "submission") */
  phase: z.string().min(1),
  /** Expected categories in this phase, in rough priority order */
  expectedCategories: z.array(ToolCategorySchema),
  /** Tools that should NOT be used in this phase (anti-patterns) */
  antiPatterns: z.array(z.string()).default([]),
  /** Minimum calls expected in this phase */
  minCalls: z.number().int().nonnegative().default(0),
  /** Maximum calls expected in this phase */
  maxCalls: z.number().int().nonnegative().optional(),
});
export type ExpectedToolPattern = z.infer<typeof ExpectedToolPatternSchema>;

/**
 * Tool choice assessment for a single tool call.
 */
export const ToolChoiceAssessmentSchema = z.strictObject({
  /** The tool call event */
  event: ToolCallEventSchema,
  /** Category of the called tool */
  category: ToolCategorySchema,
  /** Whether this tool was appropriate for the current workflow phase */
  phaseAppropriate: z.boolean(),
  /** Current workflow phase when called */
  currentPhase: z.string(),
  /** Whether this tool call follows an anti-pattern */
  isAntiPattern: z.boolean(),
  /** Whether this appears to be a duplicate call */
  isDuplicate: z.boolean(),
  /** The callId of the original call if duplicate */
  originalCallId: z.string().optional(),
  /** Quality score for this tool choice (0-1) */
  qualityScore: z.number().min(0).max(1),
  /** Reasoning for the score */
  reason: z.string(),
});
export type ToolChoiceAssessment = z.infer<typeof ToolChoiceAssessmentSchema>;

// ──────────────────────────────────────────────────────────────
// Information Request Behavior
// ──────────────────────────────────────────────────────────────

/**
 * Assessment of a case.request_information call.
 */
export const InformationRequestAssessmentSchema = z.strictObject({
  /** The tool call event */
  event: ToolCallEventSchema,
  /** Concepts requested */
  requestedConcepts: z.array(z.string()),
  /** Whether the request was specific and well-formed */
  wellFormed: z.boolean(),
  /** The tool result (if available) */
  result: ToolResultPayloadSchema.nullable(),
  /** Result status: AVAILABLE, ALREADY_PROVIDED, NEEDS_CLARIFICATION */
  resultStatus: z
    .enum(["AVAILABLE", "ALREADY_PROVIDED", "NEEDS_CLARIFICATION", "UNKNOWN"])
    .optional(),
  /** Whether the agent followed up on NEEDS_CLARIFICATION */
  followedUpOnClarification: z.boolean(),
  /** Whether the agent re-requested ALREADY_PROVIDED concepts */
  reRequestedProvided: z.boolean(),
  /** Quality score for this information request (0-1) */
  qualityScore: z.number().min(0).max(1),
  /** Reasoning */
  reason: z.string(),
});
export type InformationRequestAssessment = z.infer<
  typeof InformationRequestAssessmentSchema
>;

// ──────────────────────────────────────────────────────────────
// Recovery Behavior
// ──────────────────────────────────────────────────────────────

/**
 * Recovery action after a tool error or failure.
 */
export const RecoveryActionSchema = z.strictObject({
  /** Type of recovery attempted */
  type: z.enum([
    "RETRY_SAME_TOOL", // Retried the same tool with same/different args
    "RETRY_DIFFERENT_TOOL", // Switched to a different tool
    "REQUEST_INFORMATION", // Asked for clarification/info
    "SAVE_PARTIAL", // Saved partial artifact and continued
    "ADAPT_PLAN", // Changed approach (inferred from tool sequence)
    "NONE", // No recovery, continued to failure
  ]),
  /** The error event that triggered recovery */
  triggerEvent: ToolErrorEventSchema,
  /** The subsequent events constituting the recovery */
  recoveryEvents: z.array(EventSchema),
  /** Whether recovery led to eventual success */
  succeeded: z.boolean(),
  /** Time to recovery in events */
  eventsToRecovery: z.number().int().nonnegative(),
  /** Quality score (0-1) */
  qualityScore: z.number().min(0).max(1),
  /** Reasoning */
  reason: z.string(),
});
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

/**
 * Overall recovery behavior assessment.
 */
export const RecoveryBehaviorSchema = z.strictObject({
  /** Total tool errors encountered */
  totalErrors: z.number().int().nonnegative(),
  /** Errors that were recovered from */
  recoveredErrors: z.number().int().nonnegative(),
  /** Errors with no recovery attempt */
  unrecoveredErrors: z.number().int().nonnegative(),
  /** Recovery actions taken */
  recoveryActions: z.array(RecoveryActionSchema),
  /** Overall recovery score (0-1) */
  score: z.number().min(0).max(1),
  /** Summary */
  summary: z.string(),
});
export type RecoveryBehavior = z.infer<typeof RecoveryBehaviorSchema>;

// ──────────────────────────────────────────────────────────────
// Budget and Limit Adherence
// ──────────────────────────────────────────────────────────────

/**
 * Budget limits from the run configuration.
 */
export const BudgetLimitsSchema = z.strictObject({
  wallClockSeconds: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
  maxConcurrentToolCalls: z.number().int().positive().default(4),
});
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

/**
 * Budget usage at completion.
 */
export const BudgetUsageSchema = z.strictObject({
  wallClockSeconds: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  peakConcurrentCalls: z.number().int().nonnegative().default(0),
});
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

/**
 * Budget adherence assessment.
 */
export const BudgetAdherenceSchema = z.strictObject({
  /** Budget limits */
  limits: BudgetLimitsSchema,
  /** Actual usage */
  usage: BudgetUsageSchema,
  /** Limit warnings issued during run */
  warnings: z.array(LimitWarningEventSchema),
  /** Whether any hard limit was exceeded */
  hardLimitExceeded: z.boolean(),
  /** Which limits were exceeded */
  exceededLimits: z.array(z.string()),
  /** Utilization percentages (0-1) */
  utilization: z.strictObject({
    wallClock: z.number().min(0),
    toolCalls: z.number().min(0),
    outputBytes: z.number().min(0),
    concurrency: z.number().min(0),
  }),
  /** Score (0-1), penalized for approaching/exceeding limits */
  score: z.number().min(0).max(1),
  /** Reasoning */
  reason: z.string(),
});
export type BudgetAdherence = z.infer<typeof BudgetAdherenceSchema>;

// ──────────────────────────────────────────────────────────────
// Duplicate Call Detection
// ──────────────────────────────────────────────────────────────

/**
 * A detected duplicate tool call group.
 */
export const DuplicateCallGroupSchema = z.strictObject({
  /** Tool name */
  toolName: z.string(),
  /** Arguments that were duplicated (normalized for comparison) */
  argumentsSignature: z.string(),
  /** Number of calls in this group */
  callCount: z.number().int().positive(),
  /** The callIds in this group */
  callIds: z.array(z.string()),
  /** Whether duplicates were exact (same args) or near-duplicates */
  exactMatch: z.boolean(),
  /** Sequence numbers of the calls */
  sequences: z.array(z.number().int().positive()),
  /** Time span in seconds (if timestamps available) */
  timeSpanSeconds: z.number().nonnegative().optional(),
});
export type DuplicateCallGroup = z.infer<typeof DuplicateCallGroupSchema>;

/**
 * Duplicate call analysis.
 */
export const DuplicateCallAnalysisSchema = z.strictObject({
  /** All duplicate groups found */
  groups: z.array(DuplicateCallGroupSchema),
  /** Total duplicate calls (sum of callCount - 1 for each group) */
  totalDuplicateCalls: z.number().int().nonnegative(),
  /** Unique tools that had duplicates */
  toolsWithDuplicates: z.number().int().nonnegative(),
  /** Score (0-1), penalized for duplicates */
  score: z.number().min(0).max(1),
  /** Reasoning */
  reason: z.string(),
});
export type DuplicateCallAnalysis = z.infer<typeof DuplicateCallAnalysisSchema>;

// ──────────────────────────────────────────────────────────────
// Cancellation Behavior
// ──────────────────────────────────────────────────────────────

/**
 * Cancellation behavior assessment.
 */
export const CancellationBehaviorSchema = z.strictObject({
  /** Whether the run was cancelled */
  wasCancelled: z.boolean(),
  /** Cancellation event if present */
  cancellationEvent: RunCancelledEventSchema.nullable(),
  /** Whether agent completed gracefully before cancellation */
  gracefulCompletion: z.boolean(),
  /** Events after cancellation request (should be none for runner) */
  eventsAfterCancellation: z.number().int().nonnegative(),
  /** Whether agent saved artifacts before cancellation */
  savedArtifactsBeforeCancel: z.boolean(),
  /** Score (0-1) */
  score: z.number().min(0).max(1),
  /** Reasoning */
  reason: z.string(),
});
export type CancellationBehavior = z.infer<typeof CancellationBehaviorSchema>;

// ──────────────────────────────────────────────────────────────
// Workflow Phase Detection
// ──────────────────────────────────────────────────────────────

/**
 * Detected workflow phase based on tool usage pattern.
 */
export const WorkflowPhaseSchema = z.enum([
  "initialization", // AGENT_READY, AGENT_RUN_STARTED
  "discovery", // case.list_documents, case.search_documents, case.get_document_metadata
  "extraction", // case.read_document, case.get_structured_record
  "analysis", // policy.search, policy.get_rule, finance.calculate
  "validation", // finance.calculate_ratios, finance.validate_spread
  "information_gathering", // case.request_information
  "submission", // submission.save_artifact
  "completion", // AGENT_COMPLETED
  "unknown",
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

/**
 * Phase transition assessment.
 */
export const PhaseTransitionSchema = z.strictObject({
  fromPhase: WorkflowPhaseSchema,
  toPhase: WorkflowPhaseSchema,
  triggerEventSequence: z.number().int().positive(),
  /** Whether this is a forward progression, regression, or stall */
  direction: z.enum(["forward", "regression", "stall", "skip"]),
  /** Appropriateness of this transition (0-1) */
  appropriateness: z.number().min(0).max(1),
  /** Reasoning */
  reason: z.string(),
});
export type PhaseTransition = z.infer<typeof PhaseTransitionSchema>;

// ──────────────────────────────────────────────────────────────
// Complete Workflow Score Component
// ──────────────────────────────────────────────────────────────

export const WorkflowScoreComponentSchema = z.strictObject({
  /** Component identifier */
  component: z.literal("followup_and_workflow_behavior"),
  /** Scorer version that produced this score */
  scorerVersion: WorkflowScorerVersionSchema,
  /** Overall workflow score (0-1) */
  score: z.number().min(0).max(1),

  // Raw counts
  /** Total events analyzed */
  totalEvents: z.number().int().nonnegative(),
  /** Tool call events */
  toolCallCount: z.number().int().nonnegative(),
  /** Tool result events */
  toolResultCount: z.number().int().nonnegative(),
  /** Tool error events */
  toolErrorCount: z.number().int().nonnegative(),
  /** Information request calls */
  informationRequestCount: z.number().int().nonnegative(),
  /** Limit warnings */
  limitWarningCount: z.number().int().nonnegative(),
  /** Artifacts saved */
  artifactCount: z.number().int().nonnegative(),

  // Tool choice
  /** Tool choice assessments */
  toolChoiceAssessments: z.array(ToolChoiceAssessmentSchema),
  /** Average tool choice quality */
  toolChoiceQuality: z.number().min(0).max(1),
  /** Phase-appropriate call rate */
  phaseAppropriateRate: z.number().min(0).max(1),
  /** Anti-pattern call rate */
  antiPatternRate: z.number().min(0).max(1),

  // Information requests
  /** Information request assessments */
  informationRequestAssessments: z.array(InformationRequestAssessmentSchema),
  /** Average information request quality */
  informationRequestQuality: z.number().min(0).max(1),
  /** Follow-up on clarification rate */
  clarificationFollowUpRate: z.number().min(0).max(1),
  /** Re-request of provided info rate */
  reRequestRate: z.number().min(0).max(1),

  // Recovery
  /** Recovery behavior assessment */
  recoveryBehavior: RecoveryBehaviorSchema,

  // Budget
  /** Budget adherence assessment */
  budgetAdherence: BudgetAdherenceSchema,

  // Duplicates
  /** Duplicate call analysis */
  duplicateCallAnalysis: DuplicateCallAnalysisSchema,

  // Cancellation
  /** Cancellation behavior assessment */
  cancellationBehavior: CancellationBehaviorSchema,

  // Phase progression
  /** Detected phase transitions */
  phaseTransitions: z.array(PhaseTransitionSchema),
  /** Phase progression score */
  phaseProgressionScore: z.number().min(0).max(1),

  // Summary
  summary: z.strictObject({
    toolChoice: z.number().min(0).max(1),
    informationRequests: z.number().min(0).max(1),
    recovery: z.number().min(0).max(1),
    budgetAdherence: z.number().min(0).max(1),
    duplicateAvoidance: z.number().min(0).max(1),
    cancellation: z.number().min(0).max(1),
    phaseProgression: z.number().min(0).max(1),
  }),

  scoredAt: z.string().datetime(),
});
export type WorkflowScoreComponent = z.infer<
  typeof WorkflowScoreComponentSchema
>;

// ──────────────────────────────────────────────────────────────
// Scorer Input
// ──────────────────────────────────────────────────────────────

/**
 * Input for workflow scoring.
 */
export const WorkflowScoreInputSchema = z.strictObject({
  caseId: z.string().min(1),
  runId: z.string().min(1),
  /** Events from the trusted event log (already chain-verified) */
  events: z.array(EventSchema),
  /** Budget limits from run configuration */
  budgetLimits: BudgetLimitsSchema,
  /** Expected tool patterns for this case type (optional, for phase-appropriate scoring) */
  expectedPatterns: z.array(ExpectedToolPatternSchema).optional(),
  /** Whether to enable strict duplicate detection (default: true) */
  strictDuplicateDetection: z.boolean().default(true),
  /** Whether to penalize anti-patterns (default: true) */
  penalizeAntiPatterns: z.boolean().default(true),
  /** Whether to score phase progression (default: true) */
  scorePhaseProgression: z.boolean().default(true),
});
export type WorkflowScoreInput = z.infer<typeof WorkflowScoreInputSchema>;

// ──────────────────────────────────────────────────────────────
// Verification Result (for fail-closed on malformed events)
// ──────────────────────────────────────────────────────────────

export const EventStreamVerificationSchema = z.strictObject({
  /** Whether the event stream is valid and verifiable */
  valid: z.boolean(),
  /** Parsed events if valid */
  events: z.array(EventSchema).optional(),
  /** Error message if invalid */
  error: z.string().optional(),
  /** Whether chain verification passed */
  chainVerified: z.boolean(),
  /** Whether all events have valid schemas */
  schemasValid: z.boolean(),
  /** Number of events parsed */
  eventCount: z.number().int().nonnegative(),
});
export type EventStreamVerification = z.infer<
  typeof EventStreamVerificationSchema
>;

// ──────────────────────────────────────────────────────────────
// Default Expected Patterns for Commercial Credit
// ──────────────────────────────────────────────────────────────

/**
 * Default expected tool usage patterns for commercial credit workflows.
 */
export const DEFAULT_EXPECTED_PATTERNS: ExpectedToolPattern[] = [
  {
    phase: "discovery",
    expectedCategories: ["case", "information_request"],
    antiPatterns: [
      "finance.calculate_ratios",
      "finance.validate_spread",
      "submission.save_artifact",
    ],
    minCalls: 1,
    maxCalls: 20,
  },
  {
    phase: "extraction",
    expectedCategories: ["case"],
    antiPatterns: ["finance.validate_spread", "submission.save_artifact"],
    minCalls: 1,
    maxCalls: 30,
  },
  {
    phase: "analysis",
    expectedCategories: ["policy", "finance"],
    antiPatterns: ["submission.save_artifact"],
    minCalls: 1,
    maxCalls: 25,
  },
  {
    phase: "validation",
    expectedCategories: ["finance"],
    antiPatterns: ["case.request_information"],
    minCalls: 0,
    maxCalls: 10,
  },
  {
    phase: "submission",
    expectedCategories: ["submission"],
    antiPatterns: ["case.request_information", "finance.calculate"],
    minCalls: 1,
    maxCalls: 5,
  },
];

/**
 * Map tool name to category.
 */
export function getToolCategory(toolName: string): ToolCategory {
  if (toolName.startsWith("case.")) {
    if (toolName === "case.request_information") return "information_request";
    return "case";
  }
  if (toolName.startsWith("policy.")) return "policy";
  if (toolName.startsWith("finance.")) return "finance";
  if (toolName.startsWith("submission.")) return "submission";
  return "unknown";
}

/**
 * Detect workflow phase from recent tool calls.
 */
export function detectWorkflowPhase(
  recentCalls: ToolCallEvent[],
  patterns: ExpectedToolPattern[] = DEFAULT_EXPECTED_PATTERNS,
): WorkflowPhase {
  if (recentCalls.length === 0) return "initialization";

  // Count categories in recent calls
  const categoryCounts: Record<ToolCategory, number> = {
    case: 0,
    policy: 0,
    finance: 0,
    submission: 0,
    information_request: 0,
    unknown: 0,
  };

  for (const call of recentCalls.slice(-10)) {
    const cat = getToolCategory(call.payload.name);
    categoryCounts[cat]++;
  }

  // Find best matching phase
  let bestPhase: WorkflowPhase = "unknown";
  let bestScore = -1;

  for (const pattern of patterns) {
    let score = 0;
    for (const expectedCat of pattern.expectedCategories) {
      score += categoryCounts[expectedCat] * 2;
    }
    for (const antiCat of pattern.antiPatterns) {
      const cat = getToolCategory(antiCat);
      score -= categoryCounts[cat] * 3;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = pattern.phase as WorkflowPhase;
    }
  }

  return bestPhase;
}
