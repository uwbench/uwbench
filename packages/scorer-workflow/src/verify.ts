import { verifyEventsNDJSON } from "@uwbench/protocol";
import { type EventStreamVerification } from "./types.js";

/**
 * Verify an event stream from NDJSON string.
 * Fail-closed: any parse, schema, or chain verification error returns valid=false.
 */
export function verifyEventStream(ndjson: string): EventStreamVerification {
  const result = verifyEventsNDJSON(ndjson);

  if (!result.valid) {
    return {
      valid: false,
      events: undefined,
      error: result.error,
      chainVerified: false,
      schemasValid: false,
      eventCount: 0,
    };
  }

  return {
    valid: true,
    events: result.events,
    error: undefined,
    chainVerified: true,
    schemasValid: true,
    eventCount: result.events.length,
  };
}

/**
 * Verify an event array directly (already parsed).
 * Validates schema, sequence contiguity, unique eventIds, runId/caseId consistency, and hash chain.
 */
export function verifyEventArray(events: unknown[]): EventStreamVerification {
  if (!Array.isArray(events)) {
    return {
      valid: false,
      events: undefined,
      error: "Input is not an array",
      chainVerified: false,
      schemasValid: false,
      eventCount: 0,
    };
  }

  // Convert to NDJSON and use the existing verifyEventsNDJSON
  const ndjson = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return verifyEventStream(ndjson);
}
