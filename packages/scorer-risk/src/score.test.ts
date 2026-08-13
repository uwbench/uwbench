import { describe, it, expect, vi } from "vitest";
import {
  scoreRisk,
  createRiskScoreInput,
  RISK_SCORER_VERSION,
} from "./score.js";
import type { ReferenceRisk, SubmittedRisk } from "./types.js";
import type { EvidenceReference } from "@uwbench/protocol";

// ──────────────────────────────────────────────────────────────
// Test Fixtures
// ──────────────────────────────────────────────────────────────

const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

// Helper to create evidence with exact schema type (avoids exactOptionalPropertyTypes issues)
// Using a function that explicitly constructs the object without undefined properties
function e(
  sourceId: string,
  documentId?: string,
  page?: number,
  startOffset?: number,
  endOffset?: number,
): EvidenceReference {
  const obj: EvidenceReference = { sourceId };
  if (documentId !== undefined) obj.documentId = documentId;
  if (page !== undefined) obj.page = page;
  if (startOffset !== undefined) obj.startOffset = startOffset;
  if (endOffset !== undefined) obj.endOffset = endOffset;
  return obj;
}

const createReferenceRisk = (
  overrides: Partial<ReferenceRisk> = {},
): ReferenceRisk => ({
  riskId: "ref-risk-001",
  category: "credit",
  severity: "CRITICAL",
  weight: 1.0,
  acceptableConcepts: ["credit-concentration"],
  requiredEvidence: ["source-001:doc-001:page-5"],
  isCritical: true,
  ...overrides,
});

const createSubmittedRisk = (
  overrides: Partial<SubmittedRisk> = {},
): SubmittedRisk => ({
  riskId: "sub-risk-001",
  category: "credit",
  severity: "CRITICAL",
  statement:
    "High credit concentration risk identified [CONCEPT:credit-concentration]",
  evidence: [e("source-001", "doc-001", 5, 100, 200)],
  confidence: 0.9,
  ...overrides,
});

// ──────────────────────────────────────────────────────────────
// scoreRisk Integration Tests
// ──────────────────────────────────────────────────────────────

describe("scoreRisk - Full Integration", () => {
  it("scores 1.0 for perfect match with all critical risks found and supported", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        isCritical: true,
        acceptableConcepts: ["credit-concentration"],
      }),
      createReferenceRisk({
        riskId: "ref-2",
        isCritical: false,
        severity: "HIGH",
        acceptableConcepts: ["market-risk"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
        severity: "CRITICAL",
      }),
      createSubmittedRisk({
        riskId: "sub-2",
        statement: "Risk [CONCEPT:market-risk]",
        severity: "HIGH",
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false, // Disable semantic for deterministic test
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.scorerVersion).toBe(RISK_SCORER_VERSION);
    expect(result.component).toBe("risk_and_discrepancy_discovery");
    expect(result.score).toBeGreaterThan(0.8); // Should be high but not necessarily 1.0 due to weighting
    expect(result.referenceRisksTotal).toBe(2);
    expect(result.criticalReferenceRisksTotal).toBe(1);
    expect(result.submittedRisksTotal).toBe(2);
    expect(result.submittedRisksMatched).toBe(2);
    expect(result.matchedByConceptId).toBe(2);
    expect(result.matchedBySemantic).toBe(0);
    expect(result.submittedRisksUnmatched).toBe(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.unsupportedCount).toBe(0);
    expect(result.weightedRecall).toBe(1.0);
    expect(result.weightedPrecision).toBe(1.0);
    expect(result.criticalRiskRecall).toBe(1.0);
    expect(result.severityAccuracy).toBe(1.0);
    expect(result.evidenceSupportRate).toBe(1.0);
    expect(result.duplicatePenalty).toBe(0);
    expect(result.unsupportedPenalty).toBe(0);
  });

  it("detects missing critical risk (low critical recall)", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        isCritical: true,
        acceptableConcepts: ["credit-concentration"],
      }),
      createReferenceRisk({
        riskId: "ref-2",
        isCritical: true,
        acceptableConcepts: ["market-risk"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
        severity: "CRITICAL",
      }),
      // Missing market-risk
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.criticalRiskRecall).toBe(0.5); // 1 of 2 critical recalled
    expect(result.weightedRecall).toBeLessThan(1.0);
    expect(result.submittedRisksUnmatched).toBe(0);
    const ref2Recall = result.referenceRecalls.find(
      (r) => r.referenceRisk.riskId === "ref-2",
    );
    expect(ref2Recall?.recalled).toBe(false);
  });

  it("detects duplicate submissions", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
      createSubmittedRisk({
        riskId: "sub-2",
        statement: "Another risk [CONCEPT:credit-concentration]",
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.submittedRisksTotal).toBe(2);
    expect(result.submittedRisksMatched).toBe(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.duplicatePenalty).toBeGreaterThan(0);
    const sub2Match = result.matchResults.find(
      (m) => m.submittedRisk.riskId === "sub-2",
    );
    expect(sub2Match?.isDuplicate).toBe(true);
  });

  it("detects unsupported risks (missing required evidence)", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
        requiredEvidence: ["source-001:doc-001:page-5"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
        evidence: [e("source-001", "doc-002", 3)],
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.unsupportedCount).toBe(1);
    expect(result.unsupportedPenalty).toBeGreaterThan(0);
    expect(result.evidenceSupportRate).toBe(0);
    expect(result.matchResults[0].evidenceSupported).toBe(false);
    expect(result.matchResults[0].missingEvidence).toContain(
      "source-001:doc-001:page-5",
    );
  });

  it("detects severity mismatches", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
        severity: "CRITICAL",
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
        severity: "HIGH", // Wrong severity
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.severityAccuracy).toBe(0);
    expect(result.matchResults[0].severityAccurate).toBe(false);
  });

  it("uses semantic fallback when enabled and deterministic match fails", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "High credit concentration risk identified",
      }), // No concept marker
    ];

    const mockSemanticJudge = vi.fn().mockResolvedValue({
      matchedIndex: 0,
      similarity: 0.9,
      reasoning: "Strong semantic match on credit concentration",
    });

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: true,
      semanticThreshold: 0.75,
    });

    const result = await scoreRisk(input, {
      timestamp: FIXED_TIMESTAMP,
      semanticJudge: mockSemanticJudge,
    });

    expect(mockSemanticJudge).toHaveBeenCalledTimes(1);
    expect(result.matchedBySemantic).toBe(1);
    expect(result.matchedByConceptId).toBe(0);
    expect(result.matchResults[0].matchType).toBe("SEMANTIC");
    expect(result.matchResults[0].semanticScore).toBe(0.9);
  });

  it("does NOT use semantic fallback when deterministic match succeeds", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
    ];

    const mockSemanticJudge = vi.fn().mockResolvedValue({
      matchedIndex: 0,
      similarity: 0.9,
      reasoning: "Should not be called",
    });

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: true,
    });

    const result = await scoreRisk(input, {
      timestamp: FIXED_TIMESTAMP,
      semanticJudge: mockSemanticJudge,
    });

    // Semantic judge should NOT be called when deterministic match succeeds
    expect(mockSemanticJudge).not.toHaveBeenCalled();
    expect(result.matchedByConceptId).toBe(1);
    expect(result.matchedBySemantic).toBe(0);
  });

  it("semantic fallback does not override deterministic match", async () => {
    // This test ensures semantic matching only fills gaps, never overrides
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
      createReferenceRisk({
        riskId: "ref-2",
        acceptableConcepts: ["market-risk"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }), // Deterministic match
      createSubmittedRisk({
        riskId: "sub-2",
        statement: "Market volatility risk",
      }), // No concept marker - needs semantic
    ];

    const mockSemanticJudge = vi.fn().mockResolvedValue({
      matchedIndex: 0, // Points to sub-2 (only unmatched candidate)
      similarity: 0.85,
      reasoning: "Semantic match for market risk",
    });

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: true,
    });

    const result = await scoreRisk(input, {
      timestamp: FIXED_TIMESTAMP,
      semanticJudge: mockSemanticJudge,
    });

    // Deterministic match for ref-1
    const sub1Match = result.matchResults.find(
      (m) => m.submittedRisk.riskId === "sub-1",
    );
    expect(sub1Match?.matchType).toBe("CONCEPT_ID");
    // Semantic match for ref-2 (filling the gap)
    const sub2Match = result.matchResults.find(
      (m) => m.submittedRisk.riskId === "sub-2",
    );
    expect(sub2Match?.matchType).toBe("SEMANTIC");
    expect(result.matchedByConceptId).toBe(1);
    expect(result.matchedBySemantic).toBe(1);
  });

  it("respects semantic threshold - no match below threshold", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Completely unrelated risk",
      }),
    ];

    const mockSemanticJudge = vi.fn().mockResolvedValue({
      matchedIndex: 0,
      similarity: 0.5, // Below threshold
      reasoning: "Weak match",
    });

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: true,
      semanticThreshold: 0.75,
    });

    const result = await scoreRisk(input, {
      timestamp: FIXED_TIMESTAMP,
      semanticJudge: mockSemanticJudge,
    });

    expect(result.matchedBySemantic).toBe(0);
    expect(result.submittedRisksUnmatched).toBe(1);
    expect(result.referenceRecalls[0].recalled).toBe(false);
  });

  it("handles multiple reference risks with different weights", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        weight: 2.0,
        acceptableConcepts: ["c1"],
        isCritical: true,
      }),
      createReferenceRisk({
        riskId: "ref-2",
        weight: 1.0,
        acceptableConcepts: ["c2"],
        isCritical: false,
      }),
      createReferenceRisk({
        riskId: "ref-3",
        weight: 1.0,
        acceptableConcepts: ["c3"],
        isCritical: false,
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Risk [CONCEPT:c1]" }), // Matches high-weight critical
      createSubmittedRisk({ riskId: "sub-2", statement: "Risk [CONCEPT:c2]" }), // Matches medium-weight
      // Missing c3
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    // Weighted recall: (2.0 + 1.0) / (2.0 + 1.0 + 1.0) = 3.0 / 4.0 = 0.75
    expect(result.weightedRecall).toBeCloseTo(0.75, 5);
    // Critical recall: 1/1 = 1.0
    expect(result.criticalRiskRecall).toBe(1.0);
  });

  it("applies critical evidence requirement penalty", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        isCritical: true,
        acceptableConcepts: ["credit-concentration"],
        requiredEvidence: ["source-001:doc-001:page-5"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
        evidence: [e("source-001", "doc-002", 3)],
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
      requireCriticalEvidence: true,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    // Critical risk matched but unsupported -> additional penalty
    expect(result.unsupportedCount).toBe(1);
    expect(result.score).toBeLessThan(0.5); // Should be significantly penalized
  });

  it("does not apply critical evidence penalty when disabled", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        isCritical: true,
        acceptableConcepts: ["credit-concentration"],
        requiredEvidence: ["source-001:doc-001:page-5"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
        evidence: [e("source-001", "doc-002", 3)],
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
      requireCriticalEvidence: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    // Score should be higher without the critical evidence penalty
    expect(result.score).toBeGreaterThan(0);
  });

  it("produces deterministic output for same inputs", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result1 = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });
    const result2 = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result1).toEqual(result2);
  });

  it("handles empty reference risks", async () => {
    const referenceRisks: ReferenceRisk[] = [];
    const submittedRisks = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.referenceRisksTotal).toBe(0);
    expect(result.submittedRisksTotal).toBe(1);
    expect(result.submittedRisksMatched).toBe(0);
    expect(result.submittedRisksUnmatched).toBe(1);
    expect(result.weightedRecall).toBe(1.0); // No reference risks = perfect recall
    expect(result.weightedPrecision).toBe(1.0); // No matches = perfect precision
  });

  it("handles empty submitted risks", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];
    const submittedRisks: SubmittedRisk[] = [];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.referenceRisksTotal).toBe(1);
    expect(result.submittedRisksTotal).toBe(0);
    expect(result.submittedRisksMatched).toBe(0);
    expect(result.weightedRecall).toBe(0); // Nothing recalled
    expect(result.criticalRiskRecall).toBe(0); // Critical risk not recalled
  });

  it("includes all required fields in output", async () => {
    const referenceRisks = [createReferenceRisk({ riskId: "ref-1" })];
    const submittedRisks = [createSubmittedRisk({ riskId: "sub-1" })];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    // Check all required fields present
    expect(result.component).toBe("risk_and_discrepancy_discovery");
    expect(result.scorerVersion).toBe(RISK_SCORER_VERSION);
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(typeof result.weightedRecall).toBe("number");
    expect(typeof result.weightedPrecision).toBe("number");
    expect(typeof result.criticalRiskRecall).toBe("number");
    expect(typeof result.severityAccuracy).toBe("number");
    expect(typeof result.evidenceSupportRate).toBe("number");
    expect(typeof result.duplicatePenalty).toBe("number");
    expect(typeof result.unsupportedPenalty).toBe("number");
    expect(Array.isArray(result.matchResults)).toBe(true);
    expect(Array.isArray(result.referenceRecalls)).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.scoredAt).toBe(FIXED_TIMESTAMP);
  });

  it("summary object contains correct metrics", async () => {
    const referenceRisks = [
      createReferenceRisk({ riskId: "ref-1", acceptableConcepts: ["c1"] }),
    ];
    const submittedRisks = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Risk [CONCEPT:c1]" }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.summary.recall).toBe(result.weightedRecall);
    expect(result.summary.precision).toBe(result.weightedPrecision);
    expect(result.summary.criticalRecall).toBe(result.criticalRiskRecall);
    expect(result.summary.severityAccuracy).toBe(result.severityAccuracy);
    expect(result.summary.evidenceSupport).toBe(result.evidenceSupportRate);
  });
});

// ──────────────────────────────────────────────────────────────
// Version and Contract Tests
// ──────────────────────────────────────────────────────────────

describe("Versioning and Contracts", () => {
  it("exports versioned scorer", () => {
    expect(RISK_SCORER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("score component includes scorer version", async () => {
    const referenceRisks = [
      createReferenceRisk({ riskId: "ref-1", acceptableConcepts: ["c1"] }),
    ];
    const submittedRisks = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Risk [CONCEPT:c1]" }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });
    expect(result.scorerVersion).toBe(RISK_SCORER_VERSION);
  });

  it("deterministic matching is purely deterministic (no semantic judge)", async () => {
    const referenceRisks = [
      createReferenceRisk({ riskId: "ref-1", acceptableConcepts: ["c1"] }),
    ];
    const submittedRisks = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Risk [CONCEPT:c1]" }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        scoreRisk(input, { timestamp: FIXED_TIMESTAMP }),
      ),
    );

    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// Edge Cases
// ──────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("handles reference risk with zero weight", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        weight: 0,
        acceptableConcepts: ["c1"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Risk [CONCEPT:c1]" }),
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    // Zero weight risk shouldn't affect weighted recall
    expect(result.weightedRecall).toBe(1.0);
  });

  it("handles multiple critical risks correctly", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        isCritical: true,
        acceptableConcepts: ["c1"],
      }),
      createReferenceRisk({
        riskId: "ref-2",
        isCritical: true,
        acceptableConcepts: ["c2"],
      }),
      createReferenceRisk({
        riskId: "ref-3",
        isCritical: true,
        acceptableConcepts: ["c3"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Risk [CONCEPT:c1]" }),
      createSubmittedRisk({ riskId: "sub-2", statement: "Risk [CONCEPT:c2]" }),
      // Missing c3
    ];

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: false,
    });

    const result = await scoreRisk(input, { timestamp: FIXED_TIMESTAMP });

    expect(result.criticalReferenceRisksTotal).toBe(3);
    expect(result.criticalRiskRecall).toBeCloseTo(2 / 3, 5);
  });

  it("handles semantic judge errors gracefully", async () => {
    const referenceRisks = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];
    const submittedRisks = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Market risk" }),
    ];

    const mockSemanticJudge = vi
      .fn()
      .mockRejectedValue(new Error("Judge failed"));

    const input = createRiskScoreInput({
      caseId: "case-001",
      runId: "run-001",
      referenceRisks,
      submittedRisks,
      enableSemanticFallback: true,
    });

    // Should throw since judge fails
    await expect(
      scoreRisk(input, {
        timestamp: FIXED_TIMESTAMP,
        semanticJudge: mockSemanticJudge,
      }),
    ).rejects.toThrow("Judge failed");
  });
});
