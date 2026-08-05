import { describe, it, expect } from "vitest";
import {
  ScoreReportSchema,
  NotScoredReportSchema,
  ScoredReportSchema,
  createNotScoredReport,
  validatePhase1ScoreReport,
  SCORER_CORE_VERSION,
} from "./score.js";

describe("scorer-core contracts", () => {
  it("exports SCORER_CORE_VERSION", () => {
    expect(SCORER_CORE_VERSION).toBe("0.1.0");
  });

  it("creates a valid not_scored report", () => {
    const report = createNotScoredReport({
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
    });

    const result = NotScoredReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("not_scored");
      expect(result.data.reason).toBe("phase1_vertical_slice");
      expect(result.data.scorerVersion).toBe("0.1.0");
      expect(result.data.caseId).toBe("case-00001");
      expect(result.data.runId).toBe("run_123");
      expect(result.data.schemaVersion).toBe("1.0");
      expect(result.data.issuedAt).toBeDefined();
    }
  });

  it("creates not_scored report with custom reason and detail", () => {
    const report = createNotScoredReport({
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
      reason: "scorer_unavailable",
      detail: "Custom detail",
    });

    const result = NotScoredReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("scorer_unavailable");
      expect(result.data.detail).toBe("Custom detail");
    }
  });

  it("validates not_scored report via validatePhase1ScoreReport", () => {
    const report = createNotScoredReport({
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
    });

    const result = validatePhase1ScoreReport(report);
    expect(result.success).toBe(true);
  });

  it("rejects scored report in Phase 1 validation", () => {
    const scoredReport = {
      schemaVersion: "1.0",
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
      status: "scored" as const,
      score: 85,
      components: {},
      issuedAt: new Date().toISOString(),
    };

    const result = validatePhase1ScoreReport(scoredReport);
    expect(result.success).toBe(false);
  });

  it("ScoreReportSchema accepts not_scored and rejects scored in Phase 1", () => {
    const notScored = createNotScoredReport({
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
    });

    const notScoredResult = ScoreReportSchema.safeParse(notScored);
    expect(notScoredResult.success).toBe(true);
    if (notScoredResult.success) {
      expect(notScoredResult.data.status).toBe("not_scored");
    }

    const scored = {
      schemaVersion: "1.0",
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
      status: "scored" as const,
      score: 85,
      components: {},
      issuedAt: new Date().toISOString(),
    };

    const scoredResult = ScoreReportSchema.safeParse(scored);
    expect(scoredResult.success).toBe(false);
  });

  it("NotScoredReportSchema rejects invalid reason", () => {
    const report = {
      schemaVersion: "1.0",
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
      status: "not_scored" as const,
      reason: "invalid_reason",
      issuedAt: new Date().toISOString(),
    };

    const result = NotScoredReportSchema.safeParse(report);
    expect(result.success).toBe(false);
  });

  it("NotScoredReportSchema rejects missing required fields", () => {
    const report = {
      schemaVersion: "1.0",
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      // missing runId
      status: "not_scored" as const,
      reason: "phase1_vertical_slice",
      issuedAt: new Date().toISOString(),
    };

    const result = NotScoredReportSchema.safeParse(report);
    expect(result.success).toBe(false);
  });

  it("ScoredReportSchema validates scored report structure", () => {
    const report = {
      schemaVersion: "1.0",
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
      status: "scored" as const,
      score: 85,
      components: {
        financial: { score: 90, weight: 0.36 },
        risk: { score: 80, weight: 0.18 },
      },
      capsApplied: [],
      confidenceInterval: { lower: 80, upper: 90, level: 0.95 },
      issuedAt: new Date().toISOString(),
    };

    const result = ScoredReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.score).toBe(85);
      expect(result.data.components).toBeDefined();
      expect(result.data.confidenceInterval?.level).toBe(0.95);
    }
  });

  it("ScoredReportSchema rejects score out of range", () => {
    const report = {
      schemaVersion: "1.0",
      scorerVersion: "0.1.0",
      caseId: "case-00001",
      runId: "run_123",
      status: "scored" as const,
      score: 150, // out of range
      components: {},
      issuedAt: new Date().toISOString(),
    };

    const result = ScoredReportSchema.safeParse(report);
    expect(result.success).toBe(false);
  });
});
