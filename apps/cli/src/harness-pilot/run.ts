import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTROLLED_PROFILES,
  PILOT_HARNESS_IDS,
  createControlledAdapter,
  type HarnessAdapter,
  type HarnessProfileId,
} from "@uwbench/harness-adapter";
import { createValidRunRequest, type HarnessIdentity } from "@uwbench/testkit";
import { summarizePilot } from "./summarize.js";
import {
  PILOT_CASES,
  PILOT_DISCLAIMER,
  PILOT_TRACKS,
  TENANT_TRACK,
  type PilotCell,
  type PilotConfiguration,
  type PilotReport,
  type PilotTrack,
} from "./types.js";

const TENANT_REASON =
  "Tenant-configured adaptation is held out. It requires explicit tenant configuration or feedback and is measured separately so it is not collapsed into default or equalized scores.";

export interface RunHarnessPilotOptions {
  outputDir: string;
  repetitions?: number;
  generatedAt?: string;
}

async function completeCell(
  adapter: HarnessAdapter,
  caseId: (typeof PILOT_CASES)[number]["caseId"],
): Promise<{
  status: "completed" | "failed";
  latencyMs: number;
  identity: HarnessIdentity;
  failure?: { code: string; message: string };
}> {
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${adapter.port}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      createValidRunRequest({
        caseId,
        toolGateway: {
          url: "http://127.0.0.1:1/v1/tools/call",
          bearerToken: `pilot-${caseId}`,
        },
      }),
    ),
  });
  const accepted = (await response.json()) as { agentRunId?: string };
  if (response.status !== 202 || !accepted.agentRunId) {
    return {
      status: "failed",
      latencyMs: Date.now() - started,
      identity: CONTROLLED_PROFILES["claude-code"].identity,
      failure: { code: "START_FAILED", message: `HTTP ${response.status}` },
    };
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const statusResponse = await fetch(
      `http://127.0.0.1:${adapter.port}/v1/runs/${accepted.agentRunId}`,
    );
    const body = (await statusResponse.json()) as {
      status?: string;
      error?: { code?: string; message?: string };
    };
    if (body.status === "completed" || body.status === "failed") {
      const metadata = adapter.getRunMetadata(accepted.agentRunId);
      const result: {
        status: "completed" | "failed";
        latencyMs: number;
        identity: HarnessIdentity;
        failure?: { code: string; message: string };
      } = {
        status: body.status === "completed" ? "completed" : "failed",
        latencyMs: Date.now() - started,
        identity:
          metadata?.identity ?? CONTROLLED_PROFILES["claude-code"].identity,
      };
      if (body.status === "failed") {
        result.failure = {
          code: body.error?.code ?? "AGENT_CRASHED",
          message: body.error?.message ?? "Fixture run failed",
        };
      }
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return {
    status: "failed",
    latencyMs: Date.now() - started,
    identity: CONTROLLED_PROFILES["claude-code"].identity,
    failure: {
      code: "TIMEOUT",
      message: "Timed out waiting for fixture completion",
    },
  };
}

function configurationFor(
  track: PilotTrack,
  harness: HarnessProfileId,
  identity: HarnessIdentity,
): PilotConfiguration {
  const declaration = CONTROLLED_PROFILES[harness].declaration;
  const equalized = track === "protocol-equalized";
  return {
    track,
    equalized,
    identity,
    capabilities: equalized
      ? {
          filesystem: declaration.filesystem.controlled,
          network: declaration.network.controlled,
          memory: declaration.memory.controlled,
          approval: declaration.approval.controlled,
          connectors: [...declaration.connectors.controlled],
        }
      : {
          filesystem: declaration.filesystem.raw,
          network: declaration.network.raw,
          memory: declaration.memory.raw,
          approval: declaration.approval.raw,
          connectors: [...declaration.connectors.raw],
        },
  };
}

export async function runHarnessPilot(
  options: RunHarnessPilotOptions,
): Promise<PilotReport> {
  const repetitions = options.repetitions ?? 3;
  if (!Number.isInteger(repetitions) || repetitions < 3) {
    throw new Error("harness pilot requires at least 3 repetitions per cell");
  }
  const adapters = new Map<HarnessProfileId, HarnessAdapter>();
  const cells: PilotCell[] = [];
  try {
    for (const harness of PILOT_HARNESS_IDS) {
      const adapter = createControlledAdapter(harness, {
        port: 0,
        env: { UWBENCH_WORKER_DELAY_MS: "0" },
      });
      await adapter.start();
      adapters.set(harness, adapter);
    }
    for (const track of PILOT_TRACKS) {
      for (const harness of PILOT_HARNESS_IDS) {
        const adapter = adapters.get(harness);
        if (!adapter) throw new Error(`Missing adapter for ${harness}`);
        for (const caseDef of PILOT_CASES) {
          for (let repetition = 1; repetition <= repetitions; repetition += 1) {
            const result = await completeCell(adapter, caseDef.caseId);
            const cell: PilotCell = {
              caseId: caseDef.caseId,
              archetype: caseDef.archetype,
              harness,
              track,
              repetition,
              status: result.status,
              latencyMs: result.latencyMs,
              tokens: { input: 0, output: 0, source: "fixture-unavailable" },
              toolCalls: 0,
              costUsd: 0,
              manualInterventions: 0,
              autonomousCoverage: result.status === "completed" ? 1 : 0,
              score: {
                status: "not_scored",
                reason: PILOT_DISCLAIMER,
              },
              creditOpinion: false,
              synthetic: true,
              disclaimer: PILOT_DISCLAIMER,
              configuration: configurationFor(track, harness, result.identity),
            };
            if (result.failure) cell.failure = result.failure;
            cells.push(cell);
          }
        }
      }
    }
  } finally {
    await Promise.all([...adapters.values()].map((adapter) => adapter.stop()));
  }

  const report: PilotReport = {
    manifest: {
      schemaVersion: "1.0",
      benchmark: "commercial-credit",
      benchmarkVersion: "0.1.0",
      mode: "fixture-replay",
      creditOpinion: false,
      disclaimer: PILOT_DISCLAIMER,
      cases: PILOT_CASES,
      harnesses: [...PILOT_HARNESS_IDS],
      tracks: {
        "default-readiness": { executed: true, equalized: false },
        "protocol-equalized": { executed: true, equalized: true },
        "tenant-configured": {
          executed: false,
          heldOut: true,
          reason: TENANT_REASON,
        },
      },
      repetitions,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
    },
    cells,
    distributions: summarizePilot(cells),
    tenantConfigured: {
      track: TENANT_TRACK,
      executed: false,
      heldOut: true,
      reason: TENANT_REASON,
      cells: [],
    },
  };
  writePilotReport(options.outputDir, report);
  return report;
}

export function writePilotReport(outputDir: string, report: PilotReport): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, "manifest.json"),
    `${JSON.stringify(report.manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDir, "cells.json"),
    `${JSON.stringify({ disclaimer: PILOT_DISCLAIMER, cells: report.cells }, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDir, "summary.json"),
    `${JSON.stringify(
      {
        disclaimer: PILOT_DISCLAIMER,
        creditOpinion: false,
        distributions: report.distributions,
        tenantConfigured: report.tenantConfigured,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(outputDir, "README.md"), pilotReadme(report));
}

function pilotReadme(report: PilotReport): string {
  return `# External-harness pilot (fixture replay)

${PILOT_DISCLAIMER}

This directory records a controlled 5-case × 3-harness × ${report.manifest.repetitions}-repetition matrix for the default-readiness and protocol-equalized tracks. The tenant-configured dimension is published as held-out so it is not collapsed into either executed track.

Cases: ${report.manifest.cases.map((item) => `${item.caseId} (${item.archetype})`).join(", ")}.

Do not present these cells as lender decisions, borrower risk ratings, or real credit opinions.
`;
}
