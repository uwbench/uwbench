import { PROPOSED_DECISION_MARKER } from "./types.js";

const PRODUCT_DECISIONS = [
  "APPROVE",
  "APPROVE_WITH_CONDITIONS",
  "CONDITIONAL_APPROVE",
  "DECLINE",
  "REFER",
  "INSUFFICIENT_INFORMATION",
  "REQUEST_FURTHER_INFO",
] as const;

export const PROPOSED_DECISION_ABSENT =
  "Live MCP payload lacks proposedDecision. Outcome is blocked; not scored from memo prose or the process engine.";

export function normalizeDecisionToken(value: string): string {
  return value.trim().toUpperCase().replaceAll(" ", "_");
}

/**
 * Map a SecureLend product decision onto LOAB's outcome vocabulary.
 * APPROVE_WITH_CONDITIONS is CONDITIONAL_APPROVE, not APPROVE.
 */
export function mapProductDecisionToLoabRubricOutcome(
  decision: string,
): string {
  const normalized = normalizeDecisionToken(decision);
  if (normalized === "APPROVE_WITH_CONDITIONS") return "CONDITIONAL_APPROVE";
  if (normalized === "INSUFFICIENT_INFORMATION") return "REQUEST_FURTHER_INFO";
  return normalized;
}

export function isKnownDecisionToken(value: string): boolean {
  return (PRODUCT_DECISIONS as readonly string[]).includes(
    normalizeDecisionToken(value),
  );
}

/**
 * Read proposedDecision from a live memo / run payload. Does not consult
 * prose. Nested { decision } objects are accepted.
 */
export function proposedDecisionFromUnknown(
  value: unknown,
): string | undefined {
  const seen = new Set<unknown>();
  const visit = (node: unknown): string | undefined => {
    if (node === undefined || node === null || seen.has(node)) return undefined;
    if (typeof node === "string") {
      const marker = node.match(
        new RegExp(`<!--\\s*${PROPOSED_DECISION_MARKER}:\\s*([A-Z_]+)\\s*-->`),
      );
      if (marker?.[1] && isKnownDecisionToken(marker[1])) {
        return normalizeDecisionToken(marker[1]);
      }
      return undefined;
    }
    if (typeof node !== "object") return undefined;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    const record = node as Record<string, unknown>;
    for (const key of ["proposedDecision", "proposed_decision"]) {
      const direct = record[key];
      if (typeof direct === "string" && isKnownDecisionToken(direct)) {
        return normalizeDecisionToken(direct);
      }
      if (direct && typeof direct === "object" && !Array.isArray(direct)) {
        const nested = direct as Record<string, unknown>;
        for (const inner of ["decision", "value", "outcome"]) {
          const token = nested[inner];
          if (typeof token === "string" && isKnownDecisionToken(token)) {
            return normalizeDecisionToken(token);
          }
        }
      }
    }
    for (const nested of Object.values(record)) {
      const found = visit(nested);
      if (found) return found;
    }
    return undefined;
  };
  return visit(value);
}

export function appendProposedDecisionMarker(
  markdown: string,
  decision: string,
): string {
  const token = normalizeDecisionToken(decision);
  const marker = `<!-- ${PROPOSED_DECISION_MARKER}: ${token} -->`;
  if (markdown.includes(marker)) return markdown;
  return `${markdown.trimEnd()}\n\n${marker}\n`;
}
