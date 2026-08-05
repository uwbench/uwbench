import { z } from "zod";

/**
 * Scorer-Core Contracts
 *
 * Phase 1: Only `not_scored` result contracts are implemented.
 * Phase 2+: Full scoring components will be added without breaking changes.
 *
 * Versioning: All contracts include `scorerVersion` to track scorer implementation
 * independently from protocol/case schema versions.
 */

export const ScorerVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export type ScorerVersion = z.infer<typeof ScorerVersionSchema>;

export const ScoreStatusSchema = z.enum(["not_scored", "scored"]);
export type ScoreStatus = z.infer<typeof ScoreStatusSchema>;

/**
 * Base score report structure — extended by status-specific variants.
 * Does NOT include Phase 2 scoring fields (components, raw counts, etc.)
 * to avoid pretending scoring exists before implementation.
 */
export const BaseScoreReportSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  scorerVersion: ScorerVersionSchema,
  caseId: z.string().min(1),
  runId: z.string().min(1),
  status: ScoreStatusSchema,
  issuedAt: z.string().datetime(),
});

export type BaseScoreReport = z.infer<typeof BaseScoreReportSchema>;

/**
 * Not-scored result — Phase 1 only contract.
 * Returned when no scorer is available or Phase 1 vertical slice is executed.
 */
export const NotScoredReportSchema = BaseScoreReportSchema.extend({
  status: z.literal("not_scored"),
  reason: z.enum([
    "phase1_vertical_slice",
    "scorer_unavailable",
    "case_not_scorable",
  ]),
  detail: z.string().optional(),
});

export type NotScoredReport = z.infer<typeof NotScoredReportSchema>;

/**
 * Scored result — placeholder for Phase 2+.
 * Phase 1 validators will reject this status since no scorer exists.
 */
export const ScoredReportSchema = BaseScoreReportSchema.extend({
  status: z.literal("scored"),
  score: z.number().min(0).max(100),
  components: z.record(z.unknown()), // Phase 2: typed component scores
  capsApplied: z.array(z.string()).optional(), // Phase 2: hard caps triggered
  confidenceInterval: z
    .strictObject({
      lower: z.number().min(0).max(100),
      upper: z.number().min(0).max(100),
      level: z.number().min(0).max(1).default(0.95),
    })
    .optional(),
});

export type ScoredReport = z.infer<typeof ScoredReportSchema>;

/** Phase 1's public ScoreReport contract is deliberately not_scored-only. */
export const ScoreReportSchema = NotScoredReportSchema;

export type ScoreReport = z.infer<typeof ScoreReportSchema>;

/**
 * Validation helper — ensures only not_scored reports are accepted in Phase 1.
 */
export function validatePhase1ScoreReport(
  report: unknown,
): z.SafeParseReturnType<NotScoredReport, NotScoredReport> {
  return NotScoredReportSchema.safeParse(report);
}

/**
 * Creates a standard Phase 1 not_scored report.
 */
export function createNotScoredReport(params: {
  scorerVersion: string;
  caseId: string;
  runId: string;
  reason?: NotScoredReport["reason"];
  detail?: string;
}): NotScoredReport {
  return {
    schemaVersion: "1.0",
    scorerVersion: params.scorerVersion,
    caseId: params.caseId,
    runId: params.runId,
    status: "not_scored",
    reason: params.reason ?? "phase1_vertical_slice",
    detail: params.detail ?? "Phase 1 vertical slice — no scorer implemented",
    issuedAt: new Date().toISOString(),
  };
}

/**
 * Current scorer-core version (bump when contracts change).
 */
export const SCORER_CORE_VERSION = "0.1.0" as const;
