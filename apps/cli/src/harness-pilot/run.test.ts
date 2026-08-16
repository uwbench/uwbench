import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PILOT_HARNESS_IDS } from "@uwbench/harness-adapter";
import { runHarnessPilot } from "./run.js";
import { PILOT_CASES, PILOT_DISCLAIMER, PILOT_TRACKS } from "./types.js";

describe("harness pilot", () => {
  it("runs five cases × three harnesses × three reps in both executed tracks", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "uwbench-pilot-"));
    const report = await runHarnessPilot({
      outputDir,
      repetitions: 3,
      generatedAt: "2026-08-15T00:00:00.000Z",
    });
    expect(report.cells).toHaveLength(
      PILOT_CASES.length * PILOT_HARNESS_IDS.length * PILOT_TRACKS.length * 3,
    );
    expect(report.cells.every((cell) => cell.creditOpinion === false)).toBe(
      true,
    );
    expect(report.cells.every((cell) => cell.synthetic === true)).toBe(true);
    expect(
      report.cells.every((cell) => cell.disclaimer === PILOT_DISCLAIMER),
    ).toBe(true);
    expect(
      report.cells.every((cell) => cell.score.status === "not_scored"),
    ).toBe(true);
    expect(report.cells.every((cell) => cell.status === "completed")).toBe(
      true,
    );
    expect(
      report.cells.some((cell) => cell.track === "default-readiness"),
    ).toBe(true);
    expect(
      report.cells.some((cell) => cell.track === "protocol-equalized"),
    ).toBe(true);
    const defaultCell = report.cells.find(
      (cell) => cell.track === "default-readiness",
    );
    const equalizedCell = report.cells.find(
      (cell) => cell.track === "protocol-equalized",
    );
    expect(defaultCell?.configuration.equalized).toBe(false);
    expect(equalizedCell?.configuration.equalized).toBe(true);
    expect(defaultCell?.configuration.capabilities.memory).not.toBe(
      equalizedCell?.configuration.capabilities.memory,
    );
    expect(report.tenantConfigured.executed).toBe(false);
    expect(report.tenantConfigured.heldOut).toBe(true);
    expect(report.tenantConfigured.cells).toEqual([]);
    expect(report.manifest.tracks["tenant-configured"].heldOut).toBe(true);
    expect(report.distributions).toHaveLength(
      PILOT_HARNESS_IDS.length * PILOT_TRACKS.length,
    );
    expect(report.manifest.creditOpinion).toBe(false);
    expect(
      JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"))
        .disclaimer,
    ).toBe(PILOT_DISCLAIMER);
  }, 30_000);

  it("keeps the tenant-configured dimension held out of executed scores", () => {
    expect(
      PILOT_TRACKS.includes(
        "tenant-configured" as (typeof PILOT_TRACKS)[number],
      ),
    ).toBe(false);
  });
});
