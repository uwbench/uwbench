import { describe, it, expect } from "vitest";
import {
  EvidenceReferenceSchema,
  DocumentBoundsSchema,
  SourceBoundsSchema,
  RequiredSectionSchema,
  EvidenceScoreComponentSchema,
  EvidenceScoreInputSchema,
  EVIDENCE_SCORER_VERSION,
  DEFAULT_REQUIRED_SECTIONS,
} from "./types.js";

describe("Evidence Scorer Types", () => {
  describe("EVIDENCE_SCORER_VERSION", () => {
    it("should be a valid semver string", () => {
      expect(EVIDENCE_SCORER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("DEFAULT_REQUIRED_SECTIONS", () => {
    it("should have 5 default sections", () => {
      expect(DEFAULT_REQUIRED_SECTIONS).toHaveLength(5);
    });

    it("should have required sections marked correctly", () => {
      const required = DEFAULT_REQUIRED_SECTIONS.filter((s) => s.required);
      expect(required).toHaveLength(4); // follow_up_requests is not required
    });

    it("should have valid weights", () => {
      for (const section of DEFAULT_REQUIRED_SECTIONS) {
        expect(section.weight).toBeGreaterThan(0);
        expect(section.weight).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("EvidenceReferenceSchema", () => {
    it("should accept minimal citation with only sourceId", () => {
      const citation = { sourceId: "src_001" };
      const result = EvidenceReferenceSchema.safeParse(citation);
      expect(result.success).toBe(true);
    });

    it("should accept citation with documentId and page", () => {
      const citation = { sourceId: "src_001", documentId: "doc_001", page: 5 };
      const result = EvidenceReferenceSchema.safeParse(citation);
      expect(result.success).toBe(true);
    });

    it("should accept citation with character range", () => {
      const citation = {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: 100,
        endOffset: 200,
      };
      const result = EvidenceReferenceSchema.safeParse(citation);
      expect(result.success).toBe(true);
    });

    it("should reject citation with negative page", () => {
      const citation = { sourceId: "src_001", documentId: "doc_001", page: -1 };
      const result = EvidenceReferenceSchema.safeParse(citation);
      expect(result.success).toBe(false);
    });

    it("should reject citation with negative startOffset", () => {
      const citation = {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: -1,
      };
      const result = EvidenceReferenceSchema.safeParse(citation);
      expect(result.success).toBe(false);
    });
  });

  describe("DocumentBoundsSchema", () => {
    it("should accept valid document bounds", () => {
      const bounds = {
        sourceId: "src_001",
        documentId: "doc_001",
        pageCount: 10,
        totalCharacterCount: 5000,
        hasPages: true,
        hasCharacterOffsets: true,
        availableInLane: true,
      };
      const result = DocumentBoundsSchema.safeParse(bounds);
      expect(result.success).toBe(true);
    });

    it("should accept minimal document bounds", () => {
      const bounds = {
        sourceId: "src_001",
        documentId: "doc_001",
      };
      const result = DocumentBoundsSchema.safeParse(bounds);
      expect(result.success).toBe(true);
    });
  });

  describe("SourceBoundsSchema", () => {
    it("should accept document source with documents", () => {
      const source = {
        sourceId: "src_001",
        kind: "document" as const,
        documents: [
          { sourceId: "src_001", documentId: "doc_001", pageCount: 10 },
        ],
        records: [],
        availableInLane: true,
      };
      const result = SourceBoundsSchema.safeParse(source);
      expect(result.success).toBe(true);
    });

    it("should accept record source with records", () => {
      const source = {
        sourceId: "src_002",
        kind: "record" as const,
        documents: [],
        records: [{ sourceId: "src_002", recordId: "rec_001", rowCount: 100 }],
        availableInLane: true,
      };
      const result = SourceBoundsSchema.safeParse(source);
      expect(result.success).toBe(true);
    });
  });

  describe("RequiredSectionSchema", () => {
    it("should accept valid required section", () => {
      const section = {
        sectionId: "test_section",
        label: "Test Section",
        required: true,
        weight: 1.0,
        minCitations: 1,
        canSatisfyFromMemo: true,
        canSatisfyFromFacts: true,
        canSatisfyFromRisks: false,
      };
      const result = RequiredSectionSchema.safeParse(section);
      expect(result.success).toBe(true);
    });
  });

  describe("EvidenceScoreComponentSchema", () => {
    it("should validate a complete evidence score component", () => {
      const component = {
        component: "evidence_and_auditability",
        scorerVersion: "0.1.0",
        score: 0.85,
        citationValidation: {
          total: 10,
          valid: 8,
          unknownSource: 1,
          unknownDocument: 1,
          pageOutOfBounds: 0,
          charRangeOutOfBounds: 0,
          rowOutOfBounds: 0,
          missingAnchor: 0,
          hasFabricatedCitations: true,
          details: [],
        },
        claimSupport: [],
        factSupport: [],
        riskSupport: [],
        sectionCoverage: [],
        fabricatedCitationPenalty: {
          applied: true,
          count: 2,
          detail: "Fabricated citations detected",
          zeroesComponent: true,
        },
        summary: {
          citationReachability: 0.8,
          claimSupportRate: 0.9,
          sectionCoverageRate: 0.75,
        },
        scoredAt: new Date().toISOString(),
      };
      const result = EvidenceScoreComponentSchema.safeParse(component);
      expect(result.success).toBe(true);
    });

    it("should reject score outside 0-1 range", () => {
      const component = {
        component: "evidence_and_auditability",
        scorerVersion: "0.1.0",
        score: 1.5,
        citationValidation: {
          total: 0,
          valid: 0,
          unknownSource: 0,
          unknownDocument: 0,
          pageOutOfBounds: 0,
          charRangeOutOfBounds: 0,
          rowOutOfBounds: 0,
          missingAnchor: 0,
          hasFabricatedCitations: false,
          details: [],
        },
        claimSupport: [],
        factSupport: [],
        riskSupport: [],
        sectionCoverage: [],
        fabricatedCitationPenalty: {
          applied: false,
          count: 0,
          detail: "",
          zeroesComponent: true,
        },
        summary: {
          citationReachability: 1,
          claimSupportRate: 1,
          sectionCoverageRate: 1,
        },
        scoredAt: new Date().toISOString(),
      };
      const result = EvidenceScoreComponentSchema.safeParse(component);
      expect(result.success).toBe(false);
    });
  });

  describe("EvidenceScoreInputSchema", () => {
    it("should validate minimal input", () => {
      const input = {
        caseId: "case_001",
        runId: "run_001",
        sourceBounds: [],
        requiredSections: [],
        memoClaims: [],
        normalizedFacts: [],
        risks: [],
        lane: "reasoning_only" as const,
        enforceFabricatedCitationPenalty: true,
      };
      const result = EvidenceScoreInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});
