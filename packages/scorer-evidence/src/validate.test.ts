import { describe, it, expect } from "vitest";
import {
  validateCitation,
  validateCitationSet,
  assessClaimSupport,
  assessSectionCoverage,
  findSource,
  findDocument,
  validatePageAnchor,
  validateCharacterRange,
} from "./validate.js";
import type {
  EvidenceReference,
  SourceBounds,
  DocumentBounds,
  RequiredSection,
} from "./types.js";

describe("Citation Validation Helpers", () => {
  describe("findSource", () => {
    const sources: SourceBounds[] = [
      {
        sourceId: "src_001",
        kind: "document",
        documents: [],
        records: [],
        availableInLane: true,
      },
      {
        sourceId: "src_002",
        kind: "record",
        documents: [],
        records: [],
        availableInLane: true,
      },
    ];

    it("should find existing source", () => {
      const source = findSource(sources, "src_001");
      expect(source).toBeDefined();
      expect(source?.sourceId).toBe("src_001");
    });

    it("should return undefined for unknown source", () => {
      const source = findSource(sources, "src_999");
      expect(source).toBeUndefined();
    });
  });

  describe("findDocument", () => {
    const source: SourceBounds = {
      sourceId: "src_001",
      kind: "document",
      documents: [
        { sourceId: "src_001", documentId: "doc_001", pageCount: 10 },
        { sourceId: "src_001", documentId: "doc_002", pageCount: 5 },
      ],
      records: [],
      availableInLane: true,
    };

    it("should find existing document", () => {
      const doc = findDocument(source, "doc_001");
      expect(doc).toBeDefined();
      expect(doc?.documentId).toBe("doc_001");
    });

    it("should return undefined for unknown document", () => {
      const doc = findDocument(source, "doc_999");
      expect(doc).toBeUndefined();
    });

    it("should return undefined for non-document source", () => {
      const recordSource: SourceBounds = {
        sourceId: "src_002",
        kind: "record",
        documents: [],
        records: [],
        availableInLane: true,
      };
      const doc = findDocument(recordSource, "doc_001");
      expect(doc).toBeUndefined();
    });
  });

  describe("validatePageAnchor", () => {
    const document: DocumentBounds = {
      sourceId: "src_001",
      documentId: "doc_001",
      pageCount: 10,
      totalCharacterCount: 5000,
      hasPages: true,
      hasCharacterOffsets: true,
      availableInLane: true,
    };

    it("should accept valid page", () => {
      const result = validatePageAnchor(5, document);
      expect(result.inBounds).toBe(true);
    });

    it("should accept first page", () => {
      const result = validatePageAnchor(1, document);
      expect(result.inBounds).toBe(true);
    });

    it("should accept last page", () => {
      const result = validatePageAnchor(10, document);
      expect(result.inBounds).toBe(true);
    });

    it("should reject page 0", () => {
      const result = validatePageAnchor(0, document);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("out of bounds");
    });

    it("should reject page beyond pageCount", () => {
      const result = validatePageAnchor(11, document);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("out of bounds");
    });

    it("should reject when document has no pages", () => {
      const noPageDoc: DocumentBounds = { ...document, hasPages: false };
      const result = validatePageAnchor(1, noPageDoc);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("does not support page anchors");
    });

    it("should reject when pageCount not declared", () => {
      const noCountDoc: DocumentBounds = { ...document, pageCount: undefined };
      const result = validatePageAnchor(1, noCountDoc);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("not declared");
    });
  });

  describe("validateCharacterRange", () => {
    const document: DocumentBounds = {
      sourceId: "src_001",
      documentId: "doc_001",
      pageCount: 10,
      totalCharacterCount: 5000,
      hasPages: true,
      hasCharacterOffsets: true,
      availableInLane: true,
    };

    it("should accept valid range within bounds", () => {
      const result = validateCharacterRange(100, 200, document);
      expect(result.inBounds).toBe(true);
    });

    it("should accept range at start", () => {
      const result = validateCharacterRange(0, 100, document);
      expect(result.inBounds).toBe(true);
    });

    it("should accept range at end", () => {
      const result = validateCharacterRange(4900, 4999, document);
      expect(result.inBounds).toBe(true);
    });

    it("should reject start > end", () => {
      const result = validateCharacterRange(200, 100, document);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("Start offset exceeds end offset");
    });

    it("should reject start beyond max offset", () => {
      const result = validateCharacterRange(5000, 5100, document);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("out of bounds");
    });

    it("should reject end beyond max offset", () => {
      const result = validateCharacterRange(100, 5000, document);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("out of bounds");
    });

    it("should reject when document has no character offsets", () => {
      const noCharDoc: DocumentBounds = {
        ...document,
        hasCharacterOffsets: false,
      };
      const result = validateCharacterRange(100, 200, noCharDoc);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain(
        "does not support character offset anchors",
      );
    });

    it("should reject when totalCharacterCount not declared", () => {
      const noCountDoc: DocumentBounds = {
        ...document,
        totalCharacterCount: undefined,
      };
      const result = validateCharacterRange(100, 200, noCountDoc);
      expect(result.inBounds).toBe(false);
      expect(result.error).toContain("not declared");
    });
  });
});

describe("validateCitation", () => {
  const sourceBounds: SourceBounds[] = [
    {
      sourceId: "src_001",
      kind: "document",
      documents: [
        {
          sourceId: "src_001",
          documentId: "doc_001",
          pageCount: 10,
          totalCharacterCount: 5000,
          hasPages: true,
          hasCharacterOffsets: true,
          availableInLane: true,
        },
        {
          sourceId: "src_001",
          documentId: "doc_002",
          pageCount: 5,
          totalCharacterCount: 2000,
          hasPages: true,
          hasCharacterOffsets: true,
          availableInLane: true,
        },
      ],
      records: [],
      availableInLane: true,
    },
    {
      sourceId: "src_002",
      kind: "record",
      documents: [],
      records: [{ sourceId: "src_002", recordId: "rec_001", rowCount: 100 }],
      availableInLane: true,
    },
  ];

  describe("Valid citations", () => {
    it("should accept source-level citation", () => {
      const citation: EvidenceReference = { sourceId: "src_001" };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(true);
      expect(result.sourceExists).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept citation with valid document and page", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        page: 5,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(true);
      expect(result.pageInBounds).toBe(true);
    });

    it("should accept citation with valid character range", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: 100,
        endOffset: 200,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(true);
      expect(result.charRangeInBounds).toBe(true);
    });

    it("should accept citation with both page and character range", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        page: 5,
        startOffset: 100,
        endOffset: 200,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(true);
    });
  });

  describe("Unknown source (fabricated)", () => {
    it("should reject citation with unknown sourceId", () => {
      const citation: EvidenceReference = { sourceId: "src_999" };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.sourceExists).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining("Unknown source ID: src_999"),
      );
    });

    it("should reject citation with unknown sourceId and documentId", () => {
      const citation: EvidenceReference = {
        sourceId: "src_999",
        documentId: "doc_001",
        page: 1,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.sourceExists).toBe(false);
    });
  });

  describe("Unknown document (fabricated)", () => {
    it("should reject citation with unknown documentId", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_999",
        page: 1,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.sourceExists).toBe(true);
      expect(result.documentExists).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining("Unknown document ID: doc_999"),
      );
    });
  });

  describe("Page out of bounds", () => {
    it("should reject page > pageCount", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        page: 15,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.pageInBounds).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining("out of bounds"),
      );
    });

    it("should reject page 0", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        page: 0,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.pageInBounds).toBe(false);
    });

    it("should warn when document has pages but no page anchor", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: 100,
        endOffset: 200,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining("no page anchor"),
      );
    });
  });

  describe("Character range out of bounds", () => {
    it("should reject startOffset > totalCharacterCount", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: 6000,
        endOffset: 7000,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.charRangeInBounds).toBe(false);
    });

    it("should reject endOffset > totalCharacterCount", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: 100,
        endOffset: 6000,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.charRangeInBounds).toBe(false);
    });

    it("should reject startOffset > endOffset", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: 200,
        endOffset: 100,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.charRangeInBounds).toBe(false);
    });

    it("should warn when document has character offsets but no character range", () => {
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
        page: 5,
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining("no character range anchor"),
      );
    });
  });

  describe("Source kind mismatch", () => {
    it("should reject documentId on record source", () => {
      const citation: EvidenceReference = {
        sourceId: "src_002",
        documentId: "doc_001",
      };
      const result = validateCitation(citation, sourceBounds);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining("not a document source"),
      );
    });
  });

  describe("Missing anchor", () => {
    it("should flag missing anchor when documentId present but no page or char range", () => {
      // This is actually a source-level citation on a document source
      // which is allowed but generates a warning
      const citation: EvidenceReference = {
        sourceId: "src_001",
        documentId: "doc_001",
      };
      const result = validateCitation(citation, sourceBounds);
      // This is a valid citation but with warnings
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});

describe("validateCitationSet", () => {
  const sourceBounds: SourceBounds[] = [
    {
      sourceId: "src_001",
      kind: "document",
      documents: [
        {
          sourceId: "src_001",
          documentId: "doc_001",
          pageCount: 10,
          totalCharacterCount: 5000,
          hasPages: true,
          hasCharacterOffsets: true,
          availableInLane: true,
        },
      ],
      records: [],
      availableInLane: true,
    },
  ];

  it("should return correct counts for mixed valid/invalid citations", () => {
    const citations: EvidenceReference[] = [
      { sourceId: "src_001", documentId: "doc_001", page: 5 }, // valid
      { sourceId: "src_001", documentId: "doc_001", page: 15 }, // page out of bounds
      { sourceId: "src_999", documentId: "doc_001", page: 1 }, // unknown source
      { sourceId: "src_001", documentId: "doc_999", page: 1 }, // unknown document
      {
        sourceId: "src_001",
        documentId: "doc_001",
        startOffset: 6000,
        endOffset: 7000,
      }, // char out of bounds
    ];

    const result = validateCitationSet(citations, sourceBounds);

    expect(result.total).toBe(5);
    expect(result.valid).toBe(1);
    expect(result.unknownSource).toBe(1);
    expect(result.unknownDocument).toBe(1);
    expect(result.pageOutOfBounds).toBe(1);
    expect(result.charRangeOutOfBounds).toBe(1);
    expect(result.hasFabricatedCitations).toBe(true);
  });

  it("should handle empty citation set", () => {
    const result = validateCitationSet([], sourceBounds);
    expect(result.total).toBe(0);
    expect(result.valid).toBe(0);
    expect(result.hasFabricatedCitations).toBe(false);
  });

  it("should detect missing anchors", () => {
    const citations: EvidenceReference[] = [
      { sourceId: "src_001", documentId: "doc_001" }, // no page, no char range
    ];
    const result = validateCitationSet(citations, sourceBounds);
    expect(result.missingAnchor).toBe(1);
  });
});

describe("assessClaimSupport", () => {
  const sourceBounds: SourceBounds[] = [
    {
      sourceId: "src_001",
      kind: "document",
      documents: [
        {
          sourceId: "src_001",
          documentId: "doc_001",
          pageCount: 10,
          totalCharacterCount: 5000,
          hasPages: true,
          hasCharacterOffsets: true,
          availableInLane: true,
        },
      ],
      records: [],
      availableInLane: true,
    },
  ];

  it("should return FULLY_SUPPORTED when all citations valid", () => {
    const result = assessClaimSupport(
      "Revenue is $10M",
      [{ sourceId: "src_001", documentId: "doc_001", page: 5 }],
      sourceBounds,
    );
    expect(result.supportLevel).toBe("FULLY_SUPPORTED");
    expect(result.hasValidCitation).toBe(true);
    expect(result.allCitationsValid).toBe(true);
    expect(result.supportingCitations).toBe(1);
  });

  it("should return PARTIALLY_SUPPORTED when some citations valid", () => {
    const result = assessClaimSupport(
      "Revenue is $10M",
      [
        { sourceId: "src_001", documentId: "doc_001", page: 5 }, // valid
        { sourceId: "src_001", documentId: "doc_001", page: 15 }, // invalid page
      ],
      sourceBounds,
    );
    expect(result.supportLevel).toBe("PARTIALLY_SUPPORTED");
    expect(result.hasValidCitation).toBe(true);
    expect(result.allCitationsValid).toBe(false);
    expect(result.supportingCitations).toBe(1);
    expect(result.unsupportingCitations).toBe(1);
  });

  it("should return FABRICATED when citation references unknown source", () => {
    const result = assessClaimSupport(
      "Revenue is $10M",
      [{ sourceId: "src_999", documentId: "doc_001", page: 1 }],
      sourceBounds,
    );
    expect(result.supportLevel).toBe("FABRICATED");
    expect(result.hasValidCitation).toBe(false);
  });

  it("should return UNSUPPORTED when no valid citations", () => {
    const result = assessClaimSupport(
      "Revenue is $10M",
      [{ sourceId: "src_001", documentId: "doc_001", page: 15 }],
      sourceBounds,
    );
    expect(result.supportLevel).toBe("UNSUPPORTED");
    expect(result.hasValidCitation).toBe(false);
  });

  it("should return UNSUPPORTED when no evidence provided", () => {
    const result = assessClaimSupport("Revenue is $10M", [], sourceBounds);
    expect(result.supportLevel).toBe("UNSUPPORTED");
    expect(result.hasValidCitation).toBe(false);
    expect(result.allCitationsValid).toBe(false);
  });
});

describe("assessSectionCoverage", () => {
  const sourceBounds: SourceBounds[] = [
    {
      sourceId: "src_001",
      kind: "document",
      documents: [
        {
          sourceId: "src_001",
          documentId: "doc_001",
          pageCount: 10,
          totalCharacterCount: 5000,
          hasPages: true,
          hasCharacterOffsets: true,
          availableInLane: true,
        },
      ],
      records: [],
      availableInLane: true,
    },
  ];

  const requiredSections: RequiredSection[] = [
    {
      sectionId: "financial_spread",
      label: "Financial Spread",
      required: true,
      weight: 1.0,
      minCitations: 2,
      canSatisfyFromMemo: true,
      canSatisfyFromFacts: true,
      canSatisfyFromRisks: false,
    },
    {
      sectionId: "risk_identification",
      label: "Risk Identification",
      required: true,
      weight: 1.0,
      minCitations: 1,
      canSatisfyFromMemo: false,
      canSatisfyFromFacts: false,
      canSatisfyFromRisks: true,
    },
  ];

  it("should mark section as satisfied when minimum citations met", () => {
    const memoClaims = [
      {
        claim: "Revenue $10M",
        evidence: [
          { sourceId: "src_001", documentId: "doc_001", page: 1 },
          { sourceId: "src_001", documentId: "doc_001", page: 2 },
        ],
      },
    ];

    const result = assessSectionCoverage(
      requiredSections,
      memoClaims,
      [],
      [],
      sourceBounds,
    );

    const spreadSection = result.find(
      (s) => s.sectionId === "financial_spread",
    );
    expect(spreadSection).toBeDefined();
    expect(spreadSection?.satisfied).toBe(true);
    expect(spreadSection?.validCitations).toBe(2);
    expect(spreadSection?.meetsMinimum).toBe(true);
  });

  it("should mark section as not satisfied when minimum citations not met", () => {
    const memoClaims = [
      {
        claim: "Revenue $10M",
        evidence: [{ sourceId: "src_001", documentId: "doc_001", page: 1 }],
      },
    ];

    const result = assessSectionCoverage(
      requiredSections,
      memoClaims,
      [],
      [],
      sourceBounds,
    );

    const spreadSection = result.find(
      (s) => s.sectionId === "financial_spread",
    );
    expect(spreadSection).toBeDefined();
    expect(spreadSection?.satisfied).toBe(false);
    expect(spreadSection?.validCitations).toBe(1);
    expect(spreadSection?.meetsMinimum).toBe(false);
    expect(spreadSection?.missing).toContainEqual(
      expect.stringContaining("Minimum 2 citations required, found 1"),
    );
  });

  it("should not require optional sections to be satisfied", () => {
    const optionalSections: RequiredSection[] = [
      {
        sectionId: "optional_section",
        label: "Optional",
        required: false,
        weight: 0.5,
        minCitations: 1,
        canSatisfyFromMemo: true,
        canSatisfyFromFacts: false,
        canSatisfyFromRisks: false,
      },
    ];

    const result = assessSectionCoverage(
      optionalSections,
      [], // no claims
      [],
      [],
      sourceBounds,
    );

    expect(result[0].satisfied).toBe(true);
    expect(result[0].score).toBe(1.0);
  });

  it("should count citations from risks for risk_identification section", () => {
    const risks = [
      {
        riskId: "risk_001",
        evidence: [{ sourceId: "src_001", documentId: "doc_001", page: 3 }],
      },
    ];

    const result = assessSectionCoverage(
      requiredSections,
      [],
      [],
      risks,
      sourceBounds,
    );

    const riskSection = result.find(
      (s) => s.sectionId === "risk_identification",
    );
    expect(riskSection).toBeDefined();
    expect(riskSection?.validCitations).toBe(1);
    expect(riskSection?.satisfied).toBe(true);
  });
});
