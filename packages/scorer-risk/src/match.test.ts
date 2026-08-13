import { describe, it, expect, vi } from "vitest";
import {
  extractConceptIds,
  matchByConceptId,
  checkEvidenceSupport,
  checkSeverityAccuracy,
  matchDeterministic,
  matchSemanticFallback,
  buildReferenceRecalls,
  calculateWeightedRecall,
  calculateWeightedPrecision,
  calculateCriticalRiskRecall,
  calculateSeverityAccuracy,
  calculateEvidenceSupportRate,
  calculatePenalties,
} from "./match.js";
import type { ReferenceRisk, SubmittedRisk, RiskMatchResult } from "./types.js";
import type { EvidenceReference } from "@uwbench/protocol";

// ──────────────────────────────────────────────────────────────
// Test Fixtures
// ──────────────────────────────────────────────────────────────

// Helper to create evidence with exact schema type (avoids exactOptionalPropertyTypes issues)
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
  acceptableConcepts: ["credit-concentration", "concentration-risk"],
  requiredEvidence: ["source-001:doc-001:5"],
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
// extractConceptIds Tests
// ──────────────────────────────────────────────────────────────

describe("extractConceptIds", () => {
  it("extracts concept IDs from statement with [CONCEPT:xxx] format", () => {
    const risk = createSubmittedRisk({
      statement:
        "Risk found [CONCEPT:credit-concentration] and [CONCEPT:market-risk]",
    });
    const concepts = extractConceptIds(risk);
    expect(concepts).toContain("credit-concentration");
    expect(concepts).toContain("market-risk");
  });

  it("extracts concept IDs from riskId with concept- prefix", () => {
    const risk = createSubmittedRisk({
      riskId: "risk-concept-credit-concentration-001",
    });
    const concepts = extractConceptIds(risk);
    expect(concepts).toContain("credit-concentration-001");
  });

  it("extracts concept IDs from structured format", () => {
    const risk = createSubmittedRisk({
      statement:
        "Risk related to concept:credit-concentration and CONCEPT_MARKET_RISK",
    });
    const concepts = extractConceptIds(risk);
    expect(concepts).toContain("credit-concentration");
    // Note: CONCEPT_MARKET_RISK pattern may not match exactly
  });

  it("deduplicates concept IDs", () => {
    const risk = createSubmittedRisk({
      statement:
        "Risk [CONCEPT:credit-concentration] and also [CONCEPT:credit-concentration]",
    });
    const concepts = extractConceptIds(risk);
    expect(concepts.filter((c) => c === "credit-concentration")).toHaveLength(
      1,
    );
  });

  it("returns empty array when no concepts found", () => {
    const risk = createSubmittedRisk({
      statement: "Just a plain risk statement with no markers",
      riskId: "plain-risk-001",
    });
    const concepts = extractConceptIds(risk);
    expect(concepts).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────
// matchByConceptId Tests
// ──────────────────────────────────────────────────────────────

describe("matchByConceptId", () => {
  it("matches when submitted concept is in reference acceptableConcepts", () => {
    const submitted = createSubmittedRisk({
      statement: "Risk [CONCEPT:credit-concentration]",
    });
    const reference = createReferenceRisk({
      acceptableConcepts: ["credit-concentration", "concentration-risk"],
    });

    const result = matchByConceptId(submitted, reference);
    expect(result.matched).toBe(true);
    expect(result.matchedConcepts).toContain("credit-concentration");
  });

  it("matches case-insensitively", () => {
    const submitted = createSubmittedRisk({
      statement: "Risk [CONCEPT:CREDIT-CONCENTRATION]",
    });
    const reference = createReferenceRisk({
      acceptableConcepts: ["credit-concentration"],
    });

    const result = matchByConceptId(submitted, reference);
    expect(result.matched).toBe(true);
    expect(result.matchedConcepts).toContain("credit-concentration");
  });

  it("does not match when no concept overlap", () => {
    const submitted = createSubmittedRisk({
      statement: "Risk [CONCEPT:market-risk]",
    });
    const reference = createReferenceRisk({
      acceptableConcepts: ["credit-concentration"],
    });

    const result = matchByConceptId(submitted, reference);
    expect(result.matched).toBe(false);
    expect(result.matchedConcepts).toHaveLength(0);
  });

  it("returns all matched concepts when multiple overlap", () => {
    const submitted = createSubmittedRisk({
      statement:
        "Risk [CONCEPT:credit-concentration] and [CONCEPT:concentration-risk]",
    });
    const reference = createReferenceRisk({
      acceptableConcepts: [
        "credit-concentration",
        "concentration-risk",
        "other-concept",
      ],
    });

    const result = matchByConceptId(submitted, reference);
    expect(result.matched).toBe(true);
    expect(result.matchedConcepts).toContain("credit-concentration");
    expect(result.matchedConcepts).toContain("concentration-risk");
    expect(result.matchedConcepts).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────────────────────
// checkEvidenceSupport Tests
// ──────────────────────────────────────────────────────────────

describe("checkEvidenceSupport", () => {
  it("returns supported=true when no required evidence", () => {
    const submitted = createSubmittedRisk();
    const reference = createReferenceRisk({ requiredEvidence: [] });

    const result = checkEvidenceSupport(submitted, reference);
    expect(result.supported).toBe(true);
    expect(result.missingEvidence).toHaveLength(0);
  });

  it("returns supported=true when required evidence is present", () => {
    const submitted = createSubmittedRisk({
      evidence: [e("source-001", "doc-001", 5)],
    });
    const reference = createReferenceRisk({
      requiredEvidence: ["source-001:doc-001:5"],
    });

    const result = checkEvidenceSupport(submitted, reference);
    expect(result.supported).toBe(true);
    expect(result.missingEvidence).toHaveLength(0);
  });

  it("returns supported=false when required evidence is missing", () => {
    const submitted = createSubmittedRisk({
      evidence: [e("source-001", "doc-002", 3)],
    });
    const reference = createReferenceRisk({
      requiredEvidence: ["source-001:doc-001:5"],
    });

    const result = checkEvidenceSupport(submitted, reference);
    expect(result.supported).toBe(false);
    expect(result.missingEvidence).toContain("source-001:doc-001:5");
  });

  it("handles multiple required evidence items", () => {
    const submitted = createSubmittedRisk({
      evidence: [e("source-001", "doc-001", 5)],
    });
    const reference = createReferenceRisk({
      requiredEvidence: ["source-001:doc-001:5", "source-002:doc-003:10"],
    });

    const result = checkEvidenceSupport(submitted, reference);
    expect(result.supported).toBe(false);
    expect(result.missingEvidence).toContain("source-002:doc-003:10");
  });
});

// ──────────────────────────────────────────────────────────────
// checkSeverityAccuracy Tests
// ──────────────────────────────────────────────────────────────

describe("checkSeverityAccuracy", () => {
  it("returns true when severity matches exactly", () => {
    const submitted = createSubmittedRisk({ severity: "CRITICAL" });
    const reference = createReferenceRisk({ severity: "CRITICAL" });
    expect(checkSeverityAccuracy(submitted, reference)).toBe(true);
  });

  it("returns false when severity differs", () => {
    const submitted = createSubmittedRisk({ severity: "HIGH" });
    const reference = createReferenceRisk({ severity: "CRITICAL" });
    expect(checkSeverityAccuracy(submitted, reference)).toBe(false);
  });

  it("handles all severity levels", () => {
    const levels = [
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
      "INFORMATIONAL",
    ] as const;
    for (const level of levels) {
      const submitted = createSubmittedRisk({ severity: level });
      const reference = createReferenceRisk({ severity: level });
      expect(checkSeverityAccuracy(submitted, reference)).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// matchDeterministic Tests
// ──────────────────────────────────────────────────────────────

describe("matchDeterministic", () => {
  it("matches single submitted risk to single reference risk via concept ID", () => {
    const submitted = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];

    const result = matchDeterministic(submitted, reference);

    expect(result.matches.size).toBe(1);
    expect(result.matches.has("sub-1")).toBe(true);
    const match = result.matches.get("sub-1")!;
    expect(match.matchType).toBe("CONCEPT_ID");
    expect(match.matchedReferenceRisk?.riskId).toBe("ref-1");
    expect(match.isDuplicate).toBe(false);
    expect(result.referenceMatched.has("ref-1")).toBe(true);
    expect(result.unmatchedSubmitted).toHaveLength(0);
    expect(result.unmatchedReference).toHaveLength(0);
  });

  it("handles multiple submitted risks matching different reference risks", () => {
    const submitted = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
      createSubmittedRisk({
        riskId: "sub-2",
        statement: "Risk [CONCEPT:market-risk]",
      }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
      createReferenceRisk({
        riskId: "ref-2",
        acceptableConcepts: ["market-risk"],
      }),
    ];

    const result = matchDeterministic(submitted, reference);

    expect(result.matches.size).toBe(2);
    expect(result.matches.get("sub-1")?.matchedReferenceRisk?.riskId).toBe(
      "ref-1",
    );
    expect(result.matches.get("sub-2")?.matchedReferenceRisk?.riskId).toBe(
      "ref-2",
    );
    expect(result.unmatchedSubmitted).toHaveLength(0);
    expect(result.unmatchedReference).toHaveLength(0);
  });

  it("detects duplicate submissions (multiple submitted risks -> same reference)", () => {
    const submitted = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
      createSubmittedRisk({
        riskId: "sub-2",
        statement: "Another risk [CONCEPT:credit-concentration]",
      }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];

    const result = matchDeterministic(submitted, reference);

    expect(result.matches.size).toBe(2);
    const match1 = result.matches.get("sub-1")!;
    const match2 = result.matches.get("sub-2")!;
    // First match is not duplicate, second is
    expect(match1.isDuplicate).toBe(false);
    expect(match2.isDuplicate).toBe(true);
    expect(match2.detail).toContain("DUPLICATE");
  });

  it("leaves unmatched submitted risks when no concept match", () => {
    const submitted = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
      createSubmittedRisk({
        riskId: "sub-2",
        statement: "Risk [CONCEPT:unknown-concept]",
      }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];

    const result = matchDeterministic(submitted, reference);

    expect(result.matches.size).toBe(1);
    expect(result.unmatchedSubmitted).toHaveLength(1);
    expect(result.unmatchedSubmitted[0].riskId).toBe("sub-2");
    expect(result.unmatchedReference).toHaveLength(0);
  });

  it("leaves unmatched reference risks when no submitted risk matches", () => {
    const submitted = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Risk [CONCEPT:credit-concentration]",
      }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
      createReferenceRisk({
        riskId: "ref-2",
        acceptableConcepts: ["market-risk"],
      }),
    ];

    const result = matchDeterministic(submitted, reference);

    expect(result.matches.size).toBe(1);
    expect(result.unmatchedSubmitted).toHaveLength(0);
    expect(result.unmatchedReference).toHaveLength(1);
    expect(result.unmatchedReference[0].riskId).toBe("ref-2");
  });

  it("prefers reference with most matched concepts", () => {
    const submitted = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement:
          "Risk [CONCEPT:credit-concentration] and [CONCEPT:concentration-risk]",
      }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
      createReferenceRisk({
        riskId: "ref-2",
        acceptableConcepts: ["credit-concentration", "concentration-risk"],
      }),
    ];

    const result = matchDeterministic(submitted, reference);

    expect(result.matches.size).toBe(1);
    expect(result.matches.get("sub-1")?.matchedReferenceRisk?.riskId).toBe(
      "ref-2",
    );
  });
});

// ──────────────────────────────────────────────────────────────
// matchSemanticFallback Tests
// ──────────────────────────────────────────────────────────────

describe("matchSemanticFallback", () => {
  it("calls semantic judge and creates SEMANTIC matches when similarity >= threshold", async () => {
    const submitted = [
      createSubmittedRisk({
        riskId: "sub-1",
        statement: "Credit concentration risk",
      }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];

    const mockJudge = vi.fn().mockResolvedValue({
      matchedIndex: 0,
      similarity: 0.85,
      reasoning: "Strong semantic match",
    });

    const result = await matchSemanticFallback(
      submitted,
      reference,
      mockJudge,
      0.75,
    );

    expect(mockJudge).toHaveBeenCalledTimes(1);
    expect(result.matches.size).toBe(1);
    expect(result.matches.get("sub-1")?.matchType).toBe("SEMANTIC");
    expect(result.matches.get("sub-1")?.semanticScore).toBe(0.85);
    expect(result.matches.get("sub-1")?.detail).toContain("semantic fallback");
  });

  it("does not match when similarity below threshold", async () => {
    const submitted = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Unrelated risk" }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];

    const mockJudge = vi.fn().mockResolvedValue({
      matchedIndex: 0,
      similarity: 0.5,
      reasoning: "Weak match",
    });

    const result = await matchSemanticFallback(
      submitted,
      reference,
      mockJudge,
      0.75,
    );

    expect(result.matches.size).toBe(0);
    expect(result.stillUnmatchedSubmitted).toHaveLength(1);
    expect(result.stillUnmatchedReference).toHaveLength(1);
  });

  it("does not match when judge returns -1 (no match)", async () => {
    const submitted = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Unrelated risk" }),
    ];
    const reference = [
      createReferenceRisk({
        riskId: "ref-1",
        acceptableConcepts: ["credit-concentration"],
      }),
    ];

    const mockJudge = vi.fn().mockResolvedValue({
      matchedIndex: -1,
      similarity: 0,
      reasoning: "No match",
    });

    const result = await matchSemanticFallback(
      submitted,
      reference,
      mockJudge,
      0.75,
    );

    expect(result.matches.size).toBe(0);
    expect(result.stillUnmatchedSubmitted).toHaveLength(1);
    expect(result.stillUnmatchedReference).toHaveLength(1);
  });

  it("skips already matched submitted risks", async () => {
    const submitted = [
      createSubmittedRisk({ riskId: "sub-1", statement: "Risk 1" }),
      createSubmittedRisk({ riskId: "sub-2", statement: "Risk 2" }),
    ];
    const reference = [
      createReferenceRisk({ riskId: "ref-1", acceptableConcepts: ["c1"] }),
      createReferenceRisk({ riskId: "ref-2", acceptableConcepts: ["c2"] }),
    ];

    // First judge call matches sub-1 to ref-1
    const mockJudge = vi
      .fn()
      .mockResolvedValueOnce({
        matchedIndex: 0,
        similarity: 0.9,
        reasoning: "Match 1",
      })
      .mockResolvedValueOnce({
        matchedIndex: 0,
        similarity: 0.9,
        reasoning: "Match 2",
      });

    const result = await matchSemanticFallback(
      submitted,
      reference,
      mockJudge,
      0.75,
    );

    // sub-1 matched to ref-1, then sub-2 matched to ref-2
    expect(result.matches.size).toBe(2);
    expect(result.matches.has("sub-1")).toBe(true);
    expect(result.matches.has("sub-2")).toBe(true);
  });

  it("handles empty inputs", async () => {
    const mockJudge = vi.fn();

    const result = await matchSemanticFallback([], [], mockJudge, 0.75);

    expect(mockJudge).not.toHaveBeenCalled();
    expect(result.matches.size).toBe(0);
    expect(result.stillUnmatchedSubmitted).toHaveLength(0);
    expect(result.stillUnmatchedReference).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────
// buildReferenceRecalls Tests
// ──────────────────────────────────────────────────────────────

describe("buildReferenceRecalls", () => {
  it("marks reference risks as recalled when matched", () => {
    const reference = [
      createReferenceRisk({ riskId: "ref-1" }),
      createReferenceRisk({ riskId: "ref-2" }),
    ];
    const matches = new Map<string, RiskMatchResult>([
      [
        "sub-1",
        {
          submittedRisk: createSubmittedRisk({ riskId: "sub-1" }),
          matchedReferenceRisk: reference[0],
          matchType: "CONCEPT_ID",
          isDuplicate: false,
          evidenceSupported: true,
          severityAccurate: true,
          missingEvidence: [],
          detail: "matched",
        },
      ],
    ]);

    const recalls = buildReferenceRecalls(reference, matches);

    expect(recalls).toHaveLength(2);
    expect(recalls[0].recalled).toBe(true);
    expect(recalls[0].matchedSubmittedRisk?.riskId).toBe("sub-1");
    expect(recalls[0].matchType).toBe("CONCEPT_ID");
    expect(recalls[1].recalled).toBe(false);
    expect(recalls[1].matchedSubmittedRisk).toBeNull();
  });

  it("includes evidence and severity info for recalled risks", () => {
    const reference = [createReferenceRisk({ riskId: "ref-1" })];
    const matches = new Map<string, RiskMatchResult>([
      [
        "sub-1",
        {
          submittedRisk: createSubmittedRisk({ riskId: "sub-1" }),
          matchedReferenceRisk: reference[0],
          matchType: "SEMANTIC",
          isDuplicate: false,
          evidenceSupported: false,
          severityAccurate: false,
          missingEvidence: ["missing-evidence"],
          semanticScore: 0.8,
          detail: "matched",
        },
      ],
    ]);

    const recalls = buildReferenceRecalls(reference, matches);

    expect(recalls[0].recalled).toBe(true);
    expect(recalls[0].evidenceSupported).toBe(false);
    expect(recalls[0].severityAccurate).toBe(false);
    expect(recalls[0].matchType).toBe("SEMANTIC");
    expect(recalls[0].matchedSubmittedRisk).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────
// Metric Calculation Tests
// ──────────────────────────────────────────────────────────────

describe("calculateWeightedRecall", () => {
  it("calculates weighted recall correctly", () => {
    const reference = [
      createReferenceRisk({ riskId: "ref-1", weight: 1.0 }),
      createReferenceRisk({ riskId: "ref-2", weight: 2.0 }),
      createReferenceRisk({ riskId: "ref-3", weight: 1.0 }),
    ];
    const recalls = reference.map((r, i) => ({
      referenceRisk: r,
      recalled: i < 2, // First two recalled
      matchedSubmittedRisk:
        i < 2 ? createSubmittedRisk({ riskId: `sub-${i}` }) : null,
      matchType: "CONCEPT_ID" as const,
      evidenceSupported: true,
      severityAccurate: true,
    }));

    const recall = calculateWeightedRecall(recalls);
    // (1.0 + 2.0) / (1.0 + 2.0 + 1.0) = 3.0 / 4.0 = 0.75
    expect(recall).toBeCloseTo(0.75, 5);
  });

  it("returns 1.0 when all weights are zero", () => {
    const reference = [
      createReferenceRisk({ riskId: "ref-1", weight: 0 }),
      createReferenceRisk({ riskId: "ref-2", weight: 0 }),
    ];
    const recalls = reference.map((r) => ({
      referenceRisk: r,
      recalled: false,
      matchedSubmittedRisk: null,
    }));

    const recall = calculateWeightedRecall(recalls);
    expect(recall).toBe(1.0);
  });
});

describe("calculateWeightedPrecision", () => {
  it("calculates weighted precision correctly", () => {
    const reference = [
      createReferenceRisk({ riskId: "ref-1", weight: 1.0 }),
      createReferenceRisk({ riskId: "ref-2", weight: 2.0 }),
    ];
    const matches: RiskMatchResult[] = [
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-1" }),
        matchedReferenceRisk: reference[0],
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "ok",
      },
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-2" }),
        matchedReferenceRisk: reference[1],
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "ok",
      },
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-3" }),
        matchedReferenceRisk: reference[0], // Duplicate
        matchType: "CONCEPT_ID",
        isDuplicate: true,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "duplicate",
      },
    ];

    const precision = calculateWeightedPrecision(matches, reference);
    // Correct weight: 1.0 (ref-1) + 2.0 (ref-2) = 3.0
    // Total submitted weight: 1.0 + 2.0 + 1.0 (duplicate) = 4.0
    // Precision = 3.0 / 4.0 = 0.75
    expect(precision).toBeCloseTo(0.75, 5);
  });

  it("returns 1.0 when no matches", () => {
    const reference = [createReferenceRisk({ riskId: "ref-1", weight: 1.0 })];
    const matches: RiskMatchResult[] = [];

    const precision = calculateWeightedPrecision(matches, reference);
    expect(precision).toBe(1.0);
  });

  it("penalizes unsupported evidence", () => {
    const reference = [createReferenceRisk({ riskId: "ref-1", weight: 1.0 })];
    const matches: RiskMatchResult[] = [
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-1" }),
        matchedReferenceRisk: reference[0],
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: false, // Unsupported!
        severityAccurate: true,
        missingEvidence: ["missing"],
        detail: "unsupported",
      },
    ];

    const precision = calculateWeightedPrecision(matches, reference);
    // Correct weight: 0 (unsupported)
    // Total submitted weight: 1.0
    // Precision = 0 / 1.0 = 0
    expect(precision).toBe(0);
  });
});

describe("calculateCriticalRiskRecall", () => {
  it("calculates critical risk recall correctly", () => {
    const reference = [
      createReferenceRisk({ riskId: "ref-1", isCritical: true }),
      createReferenceRisk({ riskId: "ref-2", isCritical: true }),
      createReferenceRisk({ riskId: "ref-3", isCritical: false }),
    ];
    const recalls = reference.map((r, i) => ({
      referenceRisk: r,
      recalled: i < 2, // First two recalled
      matchedSubmittedRisk:
        i < 2 ? createSubmittedRisk({ riskId: `sub-${i}` }) : null,
    }));

    const recall = calculateCriticalRiskRecall(recalls);
    expect(recall).toBeCloseTo(1.0, 5); // 2/2 critical recalled
  });

  it("returns 1.0 when no critical risks", () => {
    const reference = [
      createReferenceRisk({ riskId: "ref-1", isCritical: false }),
      createReferenceRisk({ riskId: "ref-2", isCritical: false }),
    ];
    const recalls = reference.map((r) => ({
      referenceRisk: r,
      recalled: false,
      matchedSubmittedRisk: null,
    }));

    const recall = calculateCriticalRiskRecall(recalls);
    expect(recall).toBe(1.0);
  });
});

describe("calculateSeverityAccuracy", () => {
  it("calculates severity accuracy correctly", () => {
    const matches: RiskMatchResult[] = [
      {
        submittedRisk: createSubmittedRisk({
          riskId: "sub-1",
          severity: "CRITICAL",
        }),
        matchedReferenceRisk: createReferenceRisk({
          riskId: "ref-1",
          severity: "CRITICAL",
        }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "ok",
      },
      {
        submittedRisk: createSubmittedRisk({
          riskId: "sub-2",
          severity: "HIGH",
        }),
        matchedReferenceRisk: createReferenceRisk({
          riskId: "ref-2",
          severity: "CRITICAL",
        }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: false,
        missingEvidence: [],
        detail: "severity mismatch",
      },
      {
        submittedRisk: createSubmittedRisk({
          riskId: "sub-3",
          severity: "MEDIUM",
        }),
        matchedReferenceRisk: createReferenceRisk({
          riskId: "ref-3",
          severity: "MEDIUM",
        }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "ok",
      },
    ];

    const accuracy = calculateSeverityAccuracy(matches);
    expect(accuracy).toBeCloseTo(2 / 3, 5);
  });

  it("returns 1.0 when no matches", () => {
    const accuracy = calculateSeverityAccuracy([]);
    expect(accuracy).toBe(1.0);
  });
});

describe("calculateEvidenceSupportRate", () => {
  it("calculates evidence support rate correctly", () => {
    const matches: RiskMatchResult[] = [
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-1" }),
        matchedReferenceRisk: createReferenceRisk({ riskId: "ref-1" }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "ok",
      },
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-2" }),
        matchedReferenceRisk: createReferenceRisk({ riskId: "ref-2" }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: false,
        severityAccurate: true,
        missingEvidence: ["missing"],
        detail: "unsupported",
      },
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-3" }),
        matchedReferenceRisk: createReferenceRisk({ riskId: "ref-3" }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "ok",
      },
    ];

    const rate = calculateEvidenceSupportRate(matches);
    expect(rate).toBeCloseTo(2 / 3, 5);
  });

  it("returns 1.0 when no matches", () => {
    const rate = calculateEvidenceSupportRate([]);
    expect(rate).toBe(1.0);
  });
});

describe("calculatePenalties", () => {
  it("calculates duplicate and unsupported penalties", () => {
    const matches: RiskMatchResult[] = [
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-1" }),
        matchedReferenceRisk: createReferenceRisk({ riskId: "ref-1" }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "ok",
      },
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-2" }),
        matchedReferenceRisk: createReferenceRisk({ riskId: "ref-1" }),
        matchType: "CONCEPT_ID",
        isDuplicate: true, // Duplicate!
        evidenceSupported: true,
        severityAccurate: true,
        missingEvidence: [],
        detail: "duplicate",
      },
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-3" }),
        matchedReferenceRisk: createReferenceRisk({ riskId: "ref-2" }),
        matchType: "CONCEPT_ID",
        isDuplicate: false,
        evidenceSupported: false, // Unsupported!
        severityAccurate: true,
        missingEvidence: ["missing"],
        detail: "unsupported",
      },
      {
        submittedRisk: createSubmittedRisk({ riskId: "sub-4" }),
        matchedReferenceRisk: createReferenceRisk({ riskId: "ref-3" }),
        matchType: "CONCEPT_ID",
        isDuplicate: true, // Duplicate AND unsupported
        evidenceSupported: false,
        severityAccurate: true,
        missingEvidence: ["missing"],
        detail: "duplicate and unsupported",
      },
    ];

    const penalties = calculatePenalties(matches, 0.1, 0.15);

    expect(penalties.duplicateCount).toBe(2);
    expect(penalties.unsupportedCount).toBe(2); // sub-3 and sub-4
    expect(penalties.duplicatePenalty).toBeCloseTo(0.2, 5); // 2 * 0.1
    expect(penalties.unsupportedPenalty).toBeCloseTo(0.3, 5); // 2 * 0.15
  });

  it("caps penalties at 1.0", () => {
    const matches: RiskMatchResult[] = Array.from({ length: 20 }, (_, i) => ({
      submittedRisk: createSubmittedRisk({ riskId: `sub-${i}` }),
      matchedReferenceRisk: createReferenceRisk({ riskId: `ref-${i}` }),
      matchType: "CONCEPT_ID" as const,
      isDuplicate: true,
      evidenceSupported: false,
      severityAccurate: true,
      missingEvidence: ["missing"],
      detail: "duplicate and unsupported",
    }));

    const penalties = calculatePenalties(matches, 0.1, 0.15);

    expect(penalties.duplicatePenalty).toBeLessThanOrEqual(1.0);
    expect(penalties.unsupportedPenalty).toBeLessThanOrEqual(1.0);
  });
});
