import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const GAP_DISCLAIMER =
  "Gap-suite fixtures measure declared operational profiles. They are not real credit opinions.";

const TrackSchema = z.enum([
  "default-readiness",
  "protocol-equalized",
  "tenant-configured",
]);

const TenantProfileSchema = z.strictObject({
  heldOut: z.literal(true),
  adaptationMechanisms: z.array(z.string().min(1)).min(1),
});

const StateCaseSchema = z.strictObject({
  id: z.string().min(1),
  dimension: z.literal("state"),
  description: z.string().min(1),
  referenceCase: z.string().min(1).optional(),
  profiles: z.strictObject({
    "default-readiness": z.record(
      z.string(),
      z.union([z.boolean(), z.number()]),
    ),
    "protocol-equalized": z.record(
      z.string(),
      z.union([z.boolean(), z.number()]),
    ),
    "tenant-configured": TenantProfileSchema,
  }),
});

const ConnectorCaseSchema = z.strictObject({
  id: z.string().min(1),
  dimension: z.literal("connector"),
  description: z.string().min(1),
  availability: z.strictObject({
    "default-readiness": z.boolean(),
    "protocol-equalized": z.boolean(),
    "tenant-configured": z.boolean(),
  }),
  setupEffort: z.strictObject({
    credentials: z.number().int().nonnegative(),
    mappings: z.number().int().nonnegative(),
    manualSteps: z.number().int().nonnegative(),
    participantGlue: z.number().int().nonnegative(),
  }),
  adaptationMechanisms: z.array(z.string().min(1)).min(1),
});

const AdaptationSchema = z.strictObject({
  id: z.string().min(1),
  dimension: z.literal("adaptation"),
  description: z.string().min(1),
  heldOutCases: z
    .array(
      z.strictObject({
        caseId: z.string().min(1),
        archetype: z.string().min(1),
      }),
    )
    .min(1),
  deltas: z
    .array(
      z.strictObject({
        from: TrackSchema,
        to: TrackSchema,
        heldOut: z.literal(true),
        scoreCollapsed: z.literal(false),
        mechanisms: z.array(z.string().min(1)).min(1),
        notes: z.string().min(1),
      }),
    )
    .min(2),
});

const CatalogSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  benchmark: z.literal("commercial-credit"),
  benchmarkVersion: z.string().min(1),
  creditOpinion: z.literal(false),
  disclaimer: z.string().min(1),
  harnesses: z.array(z.string().min(1)).min(1),
  tracks: z.array(TrackSchema).length(3),
  stateCases: z.array(z.string().min(1)).min(6),
  connectorCases: z.array(z.string().min(1)).min(6),
  adaptation: z.string().min(1),
  pilotCases: z.array(z.string().min(1)).min(1),
});

export type HarnessGapCatalog = z.infer<typeof CatalogSchema>;
export type HarnessGapStateCase = z.infer<typeof StateCaseSchema>;
export type HarnessGapConnectorCase = z.infer<typeof ConnectorCaseSchema>;
export type HarnessGapAdaptation = z.infer<typeof AdaptationSchema>;

export interface HarnessGapSuite {
  catalog: HarnessGapCatalog;
  stateCases: HarnessGapStateCase[];
  connectorCases: HarnessGapConnectorCase[];
  adaptation: HarnessGapAdaptation;
}

export interface HarnessGapCounts {
  missingConnectors: {
    "default-readiness": number;
    "protocol-equalized": number;
    "tenant-configured": number;
  };
  setupEffort: {
    credentials: number;
    mappings: number;
    manualSteps: number;
    participantGlue: number;
  };
  operatorInterventions: {
    "default-readiness": number;
    "protocol-equalized": number;
  };
  participantGlue: {
    "default-readiness": number;
    "protocol-equalized": number;
  };
}

export interface HarnessGapReport {
  schemaVersion: "1.0";
  creditOpinion: false;
  disclaimer: typeof GAP_DISCLAIMER;
  generatedAt: string;
  counts: HarnessGapCounts;
  stateCaseIds: string[];
  connectorIds: string[];
  heldOutCaseIds: string[];
  adaptationMechanisms: string[];
  deltas: HarnessGapAdaptation["deltas"];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadHarnessGapSuite(root: string): HarnessGapSuite {
  const catalog = CatalogSchema.parse(readJson(join(root, "catalog.json")));
  return {
    catalog,
    stateCases: catalog.stateCases.map((relative) =>
      StateCaseSchema.parse(readJson(join(root, relative))),
    ),
    connectorCases: catalog.connectorCases.map((relative) =>
      ConnectorCaseSchema.parse(readJson(join(root, relative))),
    ),
    adaptation: AdaptationSchema.parse(
      readJson(join(root, catalog.adaptation)),
    ),
  };
}

function numberField(
  profile: Record<string, boolean | number>,
  key: string,
): number {
  const value = profile[key];
  return typeof value === "number" ? value : 0;
}

export function evaluateHarnessGapSuite(
  suite: HarnessGapSuite,
  generatedAt = "2026-08-15T00:00:00.000Z",
): HarnessGapReport {
  const missingConnectors = {
    "default-readiness": 0,
    "protocol-equalized": 0,
    "tenant-configured": 0,
  };
  const setupEffort = {
    credentials: 0,
    mappings: 0,
    manualSteps: 0,
    participantGlue: 0,
  };
  for (const connector of suite.connectorCases) {
    if (!connector.availability["default-readiness"]) {
      missingConnectors["default-readiness"] += 1;
    }
    if (!connector.availability["protocol-equalized"]) {
      missingConnectors["protocol-equalized"] += 1;
    }
    if (!connector.availability["tenant-configured"]) {
      missingConnectors["tenant-configured"] += 1;
    }
    setupEffort.credentials += connector.setupEffort.credentials;
    setupEffort.mappings += connector.setupEffort.mappings;
    setupEffort.manualSteps += connector.setupEffort.manualSteps;
    setupEffort.participantGlue += connector.setupEffort.participantGlue;
  }

  const operatorInterventions = {
    "default-readiness": 0,
    "protocol-equalized": 0,
  };
  const participantGlue = {
    "default-readiness": 0,
    "protocol-equalized": 0,
  };
  for (const stateCase of suite.stateCases) {
    operatorInterventions["default-readiness"] += numberField(
      stateCase.profiles["default-readiness"],
      "operatorInterventions",
    );
    operatorInterventions["protocol-equalized"] += numberField(
      stateCase.profiles["protocol-equalized"],
      "operatorInterventions",
    );
    participantGlue["default-readiness"] += numberField(
      stateCase.profiles["default-readiness"],
      "participantGlue",
    );
    participantGlue["protocol-equalized"] += numberField(
      stateCase.profiles["protocol-equalized"],
      "participantGlue",
    );
  }

  const adaptationMechanisms = [
    ...new Set([
      ...suite.connectorCases.flatMap((item) => item.adaptationMechanisms),
      ...suite.stateCases.flatMap(
        (item) => item.profiles["tenant-configured"].adaptationMechanisms,
      ),
      ...suite.adaptation.deltas.flatMap((item) => item.mechanisms),
    ]),
  ].sort();

  return {
    schemaVersion: "1.0",
    creditOpinion: false,
    disclaimer: GAP_DISCLAIMER,
    generatedAt,
    counts: {
      missingConnectors,
      setupEffort,
      operatorInterventions,
      participantGlue,
    },
    stateCaseIds: suite.stateCases.map((item) => item.id),
    connectorIds: suite.connectorCases.map((item) => item.id),
    heldOutCaseIds: suite.adaptation.heldOutCases.map((item) => item.caseId),
    adaptationMechanisms,
    deltas: suite.adaptation.deltas,
  };
}

export function defaultHarnessGapCasesRoot(cwd = process.cwd()): string {
  return join(cwd, "benchmark/commercial-credit-v0.1/harness-gap-cases");
}
