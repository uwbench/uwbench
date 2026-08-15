import { describe, expect, it } from "vitest";
import {
  defaultHarnessGapCasesRoot,
  evaluateHarnessGapSuite,
  GAP_DISCLAIMER,
  loadHarnessGapSuite,
} from "./harness-gaps.js";

const REQUIRED_STATE = [
  "cold-start",
  "restart-resume",
  "persisted-artifacts",
  "incremental-evidence",
  "multi-document-reconciliation",
  "cross-case-isolation",
];

const REQUIRED_CONNECTORS = [
  "crm-aggregation",
  "company-registry",
  "pep",
  "sanctions",
  "document-store",
  "market-data",
];

describe("harness gap suite", () => {
  const suite = loadHarnessGapSuite(defaultHarnessGapCasesRoot());
  const report = evaluateHarnessGapSuite(suite);

  it("covers required state and connector fixtures", () => {
    expect(suite.stateCases.map((item) => item.id).sort()).toEqual(
      [...REQUIRED_STATE].sort(),
    );
    expect(suite.connectorCases.map((item) => item.id).sort()).toEqual(
      [...REQUIRED_CONNECTORS].sort(),
    );
    expect(suite.catalog.creditOpinion).toBe(false);
    expect(report.disclaimer).toBe(GAP_DISCLAIMER);
  });

  it("counts missing connectors, setup effort, and operator glue", () => {
    expect(report.counts.missingConnectors["default-readiness"]).toBe(5);
    expect(report.counts.missingConnectors["protocol-equalized"]).toBe(6);
    expect(report.counts.missingConnectors["tenant-configured"]).toBe(0);
    expect(report.counts.setupEffort.credentials).toBeGreaterThan(0);
    expect(report.counts.setupEffort.mappings).toBeGreaterThan(0);
    expect(report.counts.setupEffort.manualSteps).toBeGreaterThan(0);
    expect(report.counts.setupEffort.participantGlue).toBeGreaterThan(0);
    expect(
      report.counts.operatorInterventions["default-readiness"],
    ).toBeGreaterThan(
      report.counts.operatorInterventions["protocol-equalized"],
    );
    expect(report.counts.participantGlue["protocol-equalized"]).toBe(0);
  });

  it("keeps adaptation deltas held out with named mechanisms", () => {
    const pilot = new Set(suite.catalog.pilotCases);
    expect(report.heldOutCaseIds).toEqual([
      "case-00006",
      "case-00007",
      "case-00008",
      "case-00009",
      "case-00010",
    ]);
    expect(report.heldOutCaseIds.some((caseId) => pilot.has(caseId))).toBe(
      false,
    );
    expect(report.deltas).toHaveLength(2);
    expect(
      report.deltas.every(
        (delta) => delta.heldOut && delta.scoreCollapsed === false,
      ),
    ).toBe(true);
    expect(report.adaptationMechanisms).toEqual(
      expect.arrayContaining([
        "connector_mappings",
        "credentials",
        "operator_feedback",
        "repository_instructions",
        "tenant_skills",
      ]),
    );
    const equalized = report.deltas.find(
      (delta) =>
        delta.from === "default-readiness" && delta.to === "protocol-equalized",
    );
    const tenant = report.deltas.find(
      (delta) =>
        delta.from === "protocol-equalized" && delta.to === "tenant-configured",
    );
    expect(equalized?.mechanisms.length).toBeGreaterThan(0);
    expect(tenant?.mechanisms.length).toBeGreaterThan(0);
  });

  it("publishes counts without treating them as credit opinions", () => {
    expect(report.creditOpinion).toBe(false);
    expect(report.stateCaseIds).toHaveLength(6);
    expect(report.connectorIds).toHaveLength(6);
  });
});
