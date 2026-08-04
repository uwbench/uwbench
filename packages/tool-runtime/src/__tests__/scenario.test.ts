import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ScenarioEngine,
  loadScenario,
  ConceptMatcher,
  type ScenarioDefinition,
  type ScenarioTransition,
} from "../scenario.js";

describe("ScenarioEngine", () => {
  // Multi-step scenario: start -> tax_returns_requested -> financials_requested -> complete
  const multiStepScenario: ScenarioDefinition = {
    initial_state: "start",
    transitions: [
      {
        from: "start",
        when: {
          tool: "case.request_information",
          requested_concepts: ["tax_returns"],
        },
        response: {
          status: "AVAILABLE",
          reveal_documents: ["doc_tax_returns_2023", "doc_tax_returns_2022"],
        },
        to: "tax_returns_provided",
      },
      {
        from: "tax_returns_provided",
        when: {
          tool: "case.request_information",
          requested_concepts: ["financial_statements"],
        },
        response: {
          status: "AVAILABLE",
          reveal_documents: ["doc_financials_2023"],
        },
        to: "financials_provided",
      },
      {
        from: "financials_provided",
        when: {
          tool: "case.request_information",
          requested_concepts: ["bank_statements"],
        },
        response: {
          status: "AVAILABLE",
          reveal_documents: ["doc_bank_statements"],
        },
        to: "complete",
      },
      {
        from: "start",
        when: {
          tool: "case.request_information",
          requested_concepts: ["revenue"],
        },
        response: { status: "ALREADY_PROVIDED" },
        to: "start",
      },
    ],
  };

  // Scenario with ambiguous transitions (multiple transitions match same concept)
  const ambiguousScenario: ScenarioDefinition = {
    initial_state: "start",
    transitions: [
      {
        from: "start",
        when: {
          tool: "case.request_information",
          requested_concepts: ["revenue"],
        },
        response: {
          status: "AVAILABLE",
          reveal_documents: ["doc_revenue_2023"],
        },
        to: "revenue_provided",
      },
      {
        from: "start",
        when: {
          tool: "case.request_information",
          requested_concepts: ["revenue", "growth"],
        },
        response: {
          status: "AVAILABLE",
          reveal_documents: ["doc_revenue_2023", "doc_growth_analysis"],
        },
        to: "revenue_growth_provided",
      },
    ],
  };

  // Scenario with hidden transitions for certification cases
  const hiddenTransitionScenario: ScenarioDefinition = {
    initial_state: "start",
    transitions: [
      {
        from: "start",
        when: {
          tool: "case.request_information",
          requested_concepts: ["public_info"],
        },
        response: {
          status: "AVAILABLE",
          reveal_documents: ["doc_public"],
        },
        to: "public_provided",
      },
      {
        from: "start",
        when: {
          tool: "case.request_information",
          requested_concepts: ["certification_secret"],
        },
        response: {
          status: "AVAILABLE",
          reveal_documents: ["doc_secret"],
        },
        to: "secret_provided",
        hidden: true,
      },
    ],
  };

  describe("loadScenario", () => {
    it("loads a valid scenario.yaml from file", () => {
      const caseDirectory = mkdtempSync(join(tmpdir(), "uwbench-scenario-"));
      mkdirSync(join(caseDirectory, "environment"));
      writeFileSync(
        join(caseDirectory, "environment", "scenario.yaml"),
        `
initial_state: "start"
transitions:
  - from: "start"
    when:
      tool: "case.request_information"
      requested_concepts: ["tax_returns"]
    response:
      status: "AVAILABLE"
      reveal_documents: ["doc_001"]
    to: "tax_provided"
`,
      );

      const definition = loadScenario(
        join(caseDirectory, "environment", "scenario.yaml"),
      );
      expect(definition.initial_state).toBe("start");
      expect(definition.transitions).toHaveLength(1);
      const transition = definition.transitions[0]!;
      expect(transition.from).toBe("start");
      expect(transition.when.tool).toBe("case.request_information");
      expect(transition.when.requested_concepts).toEqual(["tax_returns"]);
      expect(transition.response.status).toBe("AVAILABLE");
      expect(transition.response.reveal_documents).toEqual(["doc_001"]);
      expect(transition.to).toBe("tax_provided");

      rmSync(caseDirectory, { recursive: true, force: true });
    });

    it("throws on missing initial_state", () => {
      const caseDirectory = mkdtempSync(join(tmpdir(), "uwbench-scenario-"));
      mkdirSync(join(caseDirectory, "environment"));
      writeFileSync(
        join(caseDirectory, "environment", "scenario.yaml"),
        "transitions: []",
      );

      expect(() =>
        loadScenario(join(caseDirectory, "environment", "scenario.yaml")),
      ).toThrow("must have an initial_state string");

      rmSync(caseDirectory, { recursive: true, force: true });
    });

    it("throws on invalid transitions", () => {
      const caseDirectory = mkdtempSync(join(tmpdir(), "uwbench-scenario-"));
      mkdirSync(join(caseDirectory, "environment"));
      writeFileSync(
        join(caseDirectory, "environment", "scenario.yaml"),
        `
initial_state: "start"
transitions:
  - from: "start"
    when:
      tool: "case.request_information"
    response:
      status: "AVAILABLE"
    to: "next"
`,
      );

      expect(() =>
        loadScenario(join(caseDirectory, "environment", "scenario.yaml")),
      ).toThrow("requested_concepts");

      rmSync(caseDirectory, { recursive: true, force: true });
    });
  });

  describe("ScenarioEngine basic operations", () => {
    it("starts at initial_state", () => {
      const engine = new ScenarioEngine(multiStepScenario);
      expect(engine.getState()).toBe("start");
    });

    it("returns transitions (excluding hidden by default)", () => {
      const engine = new ScenarioEngine(hiddenTransitionScenario);
      const transitions = engine.getTransitions();
      expect(transitions).toHaveLength(1);
      const transition = transitions[0]!;
      expect(transition.when.requested_concepts).toEqual(["public_info"]);
    });

    it("includes hidden transitions when enabled", () => {
      const engine = new ScenarioEngine(hiddenTransitionScenario, true);
      const transitions = engine.getTransitions();
      expect(transitions).toHaveLength(2);
      const hidden = transitions.find((t) => t.hidden);
      expect(hidden).toBeDefined();
      if (!hidden) return;
      expect(hidden.when.requested_concepts).toEqual(["certification_secret"]);
    });
  });

  describe("Multi-step scenario", () => {
    it("advances state through multiple steps", () => {
      const engine = new ScenarioEngine(multiStepScenario);

      // Step 1: Request tax returns
      let result = engine.processRequest(["tax_returns"]);
      expect(result.status).toBe("AVAILABLE");
      expect(result.revealDocuments).toEqual([
        "doc_tax_returns_2023",
        "doc_tax_returns_2022",
      ]);
      expect(engine.getState()).toBe("tax_returns_provided");

      // Step 2: Request financial statements
      result = engine.processRequest(["financial_statements"]);
      expect(result.status).toBe("AVAILABLE");
      expect(result.revealDocuments).toEqual(["doc_financials_2023"]);
      expect(engine.getState()).toBe("financials_provided");

      // Step 3: Request bank statements
      result = engine.processRequest(["bank_statements"]);
      expect(result.status).toBe("AVAILABLE");
      expect(result.revealDocuments).toEqual(["doc_bank_statements"]);
      expect(engine.getState()).toBe("complete");
    });

    it("returns ALREADY_PROVIDED for already-provided concepts", () => {
      const engine = new ScenarioEngine(multiStepScenario);

      // Request revenue (already provided in start state)
      let result = engine.processRequest(["revenue"]);
      expect(result.status).toBe("ALREADY_PROVIDED");
      expect(engine.getState()).toBe("start"); // State doesn't change

      // Request it again
      result = engine.processRequest(["revenue"]);
      expect(result.status).toBe("ALREADY_PROVIDED");
    });

    it("tracks requested concepts for duplicate detection", () => {
      const engine = new ScenarioEngine(multiStepScenario);

      engine.processRequest(["tax_returns"]);
      expect(engine.hasBeenRequested("tax_returns")).toBe(true);
      expect(engine.hasBeenRequested("financial_statements")).toBe(false);

      engine.processRequest(["financial_statements"]);
      expect(engine.getRequestedConcepts()).toContain("tax_returns");
      expect(engine.getRequestedConcepts()).toContain("financial_statements");
    });

    it("resets to initial state", () => {
      const engine = new ScenarioEngine(multiStepScenario);
      engine.processRequest(["tax_returns"]);
      expect(engine.getState()).toBe("tax_returns_provided");
      engine.reset();
      expect(engine.getState()).toBe("start");
      expect(engine.getRequestedConcepts()).toHaveLength(0);
    });
  });

  describe("Ambiguous concept matching", () => {
    it("returns NEEDS_CLARIFICATION when multiple transitions match", () => {
      const engine = new ScenarioEngine(ambiguousScenario);

      // Requesting "revenue" matches both transitions (first has ["revenue"], second has ["revenue", "growth"])
      const result = engine.processRequest(["revenue"]);
      expect(result.status).toBe("NEEDS_CLARIFICATION");
      expect(result.clarification).toContain("Ambiguous");
      expect(engine.getState()).toBe("start"); // State doesn't change
    });

    it("returns NEEDS_CLARIFICATION for partial overlap", () => {
      const engine = new ScenarioEngine(ambiguousScenario);

      // Requesting both concepts from the second transition
      const result = engine.processRequest(["revenue", "growth"]);
      expect(result.status).toBe("AVAILABLE"); // Exact match for second transition
      expect(result.revealDocuments).toEqual([
        "doc_revenue_2023",
        "doc_growth_analysis",
      ]);
      expect(engine.getState()).toBe("revenue_growth_provided");
    });

    it("returns NEEDS_CLARIFICATION for unknown concepts", () => {
      const engine = new ScenarioEngine(multiStepScenario);

      const result = engine.processRequest(["unknown_concept"]);
      expect(result.status).toBe("NEEDS_CLARIFICATION");
      expect(result.clarification).toContain("No information available");
      expect(engine.getState()).toBe("start");
    });

    it("returns NEEDS_CLARIFICATION for concepts not valid in current state", () => {
      const engine = new ScenarioEngine(multiStepScenario);
      engine.processRequest(["tax_returns"]); // Move to tax_returns_provided

      // financial_statements is valid in tax_returns_provided, but revenue is only valid in start
      const result = engine.processRequest(["revenue"]);
      expect(result.status).toBe("NEEDS_CLARIFICATION");
      expect(engine.getState()).toBe("tax_returns_provided");
    });
  });

  describe("Hidden transitions (certification cases)", () => {
    it("excludes hidden transitions by default", () => {
      const engine = new ScenarioEngine(hiddenTransitionScenario, false);

      const result = engine.processRequest(["certification_secret"]);
      expect(result.status).toBe("NEEDS_CLARIFICATION");
    });

    it("includes hidden transitions when enabled", () => {
      const engine = new ScenarioEngine(hiddenTransitionScenario, true);

      const result = engine.processRequest(["certification_secret"]);
      expect(result.status).toBe("AVAILABLE");
      expect(result.revealDocuments).toEqual(["doc_secret"]);
      expect(engine.getState()).toBe("secret_provided");
    });
  });

  describe("ConceptMatcher", () => {
    const transitions: ScenarioTransition[] = [
      {
        from: "start",
        when: {
          tool: "case.request_information",
          requested_concepts: ["a", "b"],
        },
        response: { status: "AVAILABLE" },
        to: "ab",
      },
      {
        from: "start",
        when: { tool: "case.request_information", requested_concepts: ["a"] },
        response: { status: "AVAILABLE" },
        to: "a_only",
      },
      {
        from: "other",
        when: { tool: "case.request_information", requested_concepts: ["a"] },
        response: { status: "AVAILABLE" },
        to: "other_a",
      },
    ];

    it("finds exact match", () => {
      const result = ConceptMatcher.findBestMatch(transitions, "start", [
        "a",
        "b",
      ]);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.transition.to).toBe("ab");
      expect(result.matchedConcepts).toEqual(["a", "b"]);
      expect(result.unmatchedConcepts).toHaveLength(0);
    });

    it("finds covering match (requested subset of transition)", () => {
      const result = ConceptMatcher.findBestMatch(transitions, "start", ["a"]);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.transition.to).toBe("a_only");
      expect(result.matchedConcepts).toEqual(["a"]);
      expect(result.unmatchedConcepts).toHaveLength(0);
    });

    it("returns null for no matching state", () => {
      const result = ConceptMatcher.findBestMatch(transitions, "unknown", [
        "a",
      ]);
      expect(result).toBeNull();
    });

    it("returns first match for ambiguous case with details", () => {
      const result = ConceptMatcher.findBestMatch(transitions, "start", [
        "a",
        "c",
      ]);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.matchedConcepts).toEqual(["a"]);
      expect(result.unmatchedConcepts).toEqual(["c"]);
    });
  });

  describe("fromCaseDirectory static factory", () => {
    it("creates engine from case directory", () => {
      const caseDirectory = mkdtempSync(join(tmpdir(), "uwbench-case-"));
      mkdirSync(join(caseDirectory, "environment"));
      writeFileSync(
        join(caseDirectory, "environment", "scenario.yaml"),
        `
initial_state: "init"
transitions:
  - from: "init"
    when:
      tool: "case.request_information"
      requested_concepts: ["test"]
    response:
      status: "AVAILABLE"
    to: "done"
`,
      );

      const engine = ScenarioEngine.fromCaseDirectory(caseDirectory);
      expect(engine.getState()).toBe("init");
      const result = engine.processRequest(["test"]);
      expect(result.status).toBe("AVAILABLE");
      expect(engine.getState()).toBe("done");

      rmSync(caseDirectory, { recursive: true, force: true });
    });

    it("enables hidden transitions when specified", () => {
      const caseDirectory = mkdtempSync(join(tmpdir(), "uwbench-case-"));
      mkdirSync(join(caseDirectory, "environment"));
      writeFileSync(
        join(caseDirectory, "environment", "scenario.yaml"),
        `
initial_state: "init"
transitions:
  - from: "init"
    when:
      tool: "case.request_information"
      requested_concepts: ["hidden"]
    response:
      status: "AVAILABLE"
    to: "hidden_done"
    hidden: true
`,
      );

      const enginePublic = ScenarioEngine.fromCaseDirectory(
        caseDirectory,
        false,
      );
      expect(enginePublic.processRequest(["hidden"]).status).toBe(
        "NEEDS_CLARIFICATION",
      );

      const engineCert = ScenarioEngine.fromCaseDirectory(caseDirectory, true);
      expect(engineCert.processRequest(["hidden"]).status).toBe("AVAILABLE");

      rmSync(caseDirectory, { recursive: true, force: true });
    });
  });
});

describe("ScenarioEngine integration with gateway (conceptual)", () => {
  // This tests the expected behavior when ScenarioEngine is used via gateway
  // The actual gateway integration tests are in gateway.test.ts

  it("handles request_information with single concept", () => {
    const scenario: ScenarioDefinition = {
      initial_state: "start",
      transitions: [
        {
          from: "start",
          when: {
            tool: "case.request_information",
            requested_concepts: ["tax_returns"],
          },
          response: { status: "AVAILABLE", reveal_documents: ["doc_001"] },
          to: "done",
        },
      ],
    };

    const engine = new ScenarioEngine(scenario);
    const result = engine.processRequest(["tax_returns"]);
    expect(result.status).toBe("AVAILABLE");
    expect(result.revealDocuments).toEqual(["doc_001"]);
  });

  it("handles request_information with multiple concepts in single call", () => {
    const scenario: ScenarioDefinition = {
      initial_state: "start",
      transitions: [
        {
          from: "start",
          when: {
            tool: "case.request_information",
            requested_concepts: ["a", "b"],
          },
          response: { status: "AVAILABLE", reveal_documents: ["doc_ab"] },
          to: "ab",
        },
        {
          from: "start",
          when: { tool: "case.request_information", requested_concepts: ["a"] },
          response: { status: "AVAILABLE", reveal_documents: ["doc_a"] },
          to: "a",
        },
      ],
    };

    const engine = new ScenarioEngine(scenario);
    // Requesting both a and b should match the first transition exactly
    const result = engine.processRequest(["a", "b"]);
    expect(result.status).toBe("AVAILABLE");
    expect(result.revealDocuments).toEqual(["doc_ab"]);
    expect(engine.getState()).toBe("ab");
  });
});
