import type { ArchiveLane } from "./types.js";

/**
 * Authoritative participant-visible filesystem projection for each lane.
 * Runtime staging and input archive packing must both use this table.
 */
export const LANE_PROJECTIONS: Record<ArchiveLane, readonly string[]> = {
  raw_documents: [
    "case.yaml",
    "task.md",
    "environment/scenario.yaml",
    "inputs/documents",
    "inputs/policy",
  ],
  normalized_data: [
    "case.yaml",
    "task.md",
    "environment/scenario.yaml",
    "normalized/canonical-input.json",
    "inputs/policy",
  ],
  reasoning_only: [
    "case.yaml",
    "task.md",
    "environment/scenario.yaml",
    "normalized/canonical-input.json",
  ],
};

export function getLaneProjection(lane: ArchiveLane): readonly string[] {
  return LANE_PROJECTIONS[lane];
}

export function isPathVisibleInLane(
  lane: ArchiveLane,
  relativePath: string,
): boolean {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  return getLaneProjection(lane).some(
    (entry) => normalized === entry || normalized.startsWith(`${entry}/`),
  );
}
