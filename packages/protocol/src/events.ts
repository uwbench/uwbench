import { z } from "zod";
import { createHash } from "node:crypto";
import { canonicalizeJcs } from "./jcs.js";

/**
 * RFC 8785 (JCS) canonicalization and SHA-256 hash chain for event log.
 * Hash = sha256:JCS(event excluding hash field, including previousHash)
 */

export const EventTypeSchema = z.enum([
  "RUN_STARTED",
  "AGENT_READY",
  "AGENT_RUN_STARTED",
  "TOOL_CALL",
  "TOOL_RESULT",
  "TOOL_ERROR",
  "ARTIFACT_SAVED",
  "LIMIT_WARNING",
  "AGENT_COMPLETED",
  "AGENT_FAILED",
  "RUN_CANCELLED",
  "RUN_COMPLETED",
  "SCORING_STARTED",
  "SCORE_COMPONENT_CREATED",
  "SCORING_COMPLETED",
]);

export const EventSourceSchema = z.enum([
  "RUNNER",
  "AGENT",
  "TOOL_GATEWAY",
  "SCORER",
]);

export const BaseEventSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    eventId: z.string(),
    runId: z.string(),
    caseId: z.string(),
    sequence: z.number().int().positive(),
    timestamp: z.string().datetime(),
    source: EventSourceSchema,
    type: EventTypeSchema,
    payload: z.record(z.string(), z.json()),
    previousHash: z.string(),
    hash: z.string(),
  })
  .strict();

export const EventSchema = BaseEventSchema;

export type EventType = z.infer<typeof EventTypeSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type Event = z.infer<typeof EventSchema>;

/**
 * Event without the hash field, used for canonicalization.
 */
export type EventWithoutHash = Omit<Event, "hash">;

/**
 * Compute SHA-256 hash of event using RFC 8785 (JCS) canonicalization.
 * Excludes the hash field, includes previousHash.
 */
export function computeHash(event: EventWithoutHash): string {
  const canonical = canonicalizeJcs(event);
  const hash = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Verify the hash chain of an event array.
 * - First event must have previousHash === "sha256:genesis"
 * - Each event's previousHash must match previous event's hash
 * - Each event's hash must match computeHash(event)
 * - Sequence numbers must be contiguous starting from 1
 * - runId and caseId must be consistent across all events
 * - No duplicate eventIds or sequence numbers
 */
export function verifyChain(events: Event[]): boolean {
  if (events.length === 0) return true;

  const seenEventIds = new Set<string>();
  const seenSequences = new Set<number>();
  const firstRunId = events[0]!.runId;
  const firstCaseId = events[0]!.caseId;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) return false;

    // Check runId consistency
    if (event.runId !== firstRunId) {
      return false;
    }
    // Check caseId consistency
    if (event.caseId !== firstCaseId) {
      return false;
    }
    // Check for duplicate eventId
    if (seenEventIds.has(event.eventId)) {
      return false;
    }
    seenEventIds.add(event.eventId);
    // Check for duplicate sequence
    if (seenSequences.has(event.sequence)) {
      return false;
    }
    seenSequences.add(event.sequence);
    // Check sequence is contiguous (1, 2, 3, ...)
    if (event.sequence !== i + 1) {
      return false;
    }

    const expectedPrevHash = i === 0 ? "sha256:genesis" : events[i - 1]!.hash;
    if (!expectedPrevHash || event.previousHash !== expectedPrevHash) {
      return false;
    }

    const { hash: _hash, ...eventWithoutHash } = event;
    if (event.hash !== computeHash(eventWithoutHash)) {
      return false;
    }
  }
  return true;
}

/**
 * Write events to an NDJSON (newline-delimited JSON) string.
 */
export function writeEventsNDJSON(events: Event[]): string {
  return (
    events.map((e) => JSON.stringify(e)).join("\n") +
    (events.length > 0 ? "\n" : "")
  );
}

/**
 * Parse events from an NDJSON string.
 * Throws on any malformed or invalid record (fail-closed).
 * Validates schema, sequence contiguity, unique eventIds, and runId/caseId consistency.
 */
export function readEventsNDJSON(ndjson: string): Event[] {
  const events: Event[] = [];
  const lines = ndjson.trim().split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new Error(`NDJSON parse error at line ${i + 1}: ${e}`);
    }
    const result = EventSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `NDJSON schema validation failed at line ${i + 1}: ${result.error.message}`,
      );
    }
    events.push(result.data);
  }
  // Verify chain integrity after parsing all events
  if (!verifyChain(events)) {
    throw new Error(
      "NDJSON hash chain verification failed: sequence gap, duplicate, runId/caseId mismatch, or hash corruption",
    );
  }
  return events;
}

/**
 * Verify events from an NDJSON string.
 * Returns { valid: boolean, events: Event[], error?: string }
 * Fail-closed: any parse or validation error returns valid=false with error.
 */
export function verifyEventsNDJSON(ndjson: string): {
  valid: boolean;
  events: Event[];
  error?: string | undefined;
} {
  try {
    const events = readEventsNDJSON(ndjson);
    return { valid: true, events, error: undefined };
  } catch (e) {
    return {
      valid: false,
      events: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
