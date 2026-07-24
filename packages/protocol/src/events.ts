import { z } from "zod";
import canonicalize from "canonical-json";
import { createHash } from "node:crypto";

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

export const BaseEventSchema = z.object({
  schemaVersion: z.literal("1.0"),
  eventId: z.string(),
  runId: z.string(),
  caseId: z.string(),
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime(),
  source: EventSourceSchema,
  type: EventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  previousHash: z.string(),
  hash: z.string(),
});

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
  const canonical = canonicalize(event);
  if (canonical === undefined) {
    throw new Error("Canonicalization returned undefined");
  }
  const hash = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Verify the hash chain of an event array.
 * - First event must have previousHash === "sha256:genesis"
 * - Each event's previousHash must match previous event's hash
 * - Each event's hash must match computeHash(event)
 */
export function verifyChain(events: Event[]): boolean {
  if (events.length === 0) return true;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) return false;

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
 * Invalid lines are skipped with a warning logged to stderr.
 */
export function readEventsNDJSON(ndjson: string): Event[] {
  const events: Event[] = [];
  const lines = ndjson.trim().split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      const result = EventSchema.safeParse(parsed);
      if (result.success) {
        events.push(result.data);
      } else {
        console.error(
          `[NDJSON] Invalid event at line ${i + 1}:`,
          result.error.format(),
        );
      }
    } catch (e) {
      console.error(`[NDJSON] Parse error at line ${i + 1}:`, e);
    }
  }
  return events;
}

/**
 * Verify events from an NDJSON string.
 * Returns { valid: boolean, events: Event[], error?: string }
 */
export function verifyEventsNDJSON(ndjson: string): {
  valid: boolean;
  events: Event[];
  error?: string | undefined;
} {
  const events = readEventsNDJSON(ndjson);
  if (events.length === 0) {
    return { valid: true, events: [] };
  }
  const valid = verifyChain(events);
  return {
    valid,
    events,
    error: valid ? undefined : "Hash chain verification failed",
  };
}
