/**
 * @uwbench/scorer-risk — Deterministic risk annotation matcher
 *
 * Matches deterministic risk concepts and scores recall, precision, severity,
 * and evidence support.
 *
 * Key principles:
 * - Stable concept IDs are matched before any semantic fallback
 * - Critical-risk recall, severity accuracy, duplicate, and unsupported penalties are reported
 * - Semantic judging is only used for inconclusive matches and cannot override deterministic results
 */

export * from "./types.js";
export * from "./match.js";
export {
  scoreRisk,
  createRiskScoreInput,
  RISK_SCORER_VERSION,
} from "./score.js";
