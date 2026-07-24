import { describe, it, expect } from "vitest";
import canonicalize from "canonical-json";
import { createHash } from "node:crypto";
import {
  EventTypeSchema,
  EventSourceSchema,
  EventSchema,
  type EventType,
  type EventSource,
  type Event,
  type EventWithoutHash,
  computeHash,
  verifyChain,
  writeEventsNDJSON,
  readEventsNDJSON,
  verifyEventsNDJSON,
} from "./events.js";

function createBaseEvent(
  overrides: Partial<EventWithoutHash> = {},
): EventWithoutHash {
  return {
    schemaVersion: "1.0",
    eventId: "evt_001",
    runId: "run_001",
    caseId: "case_001",
    sequence: 1,
    timestamp: new Date().toISOString(),
    source: "RUNNER",
    type: "RUN_STARTED",
    payload: {},
    previousHash: "sha256:genesis",
    ...overrides,
  };
}

function createEvent(overrides: Partial<EventWithoutHash> = {}): Event {
  const base = createBaseEvent(overrides);
  return { ...base, hash: computeHash(base) };
}

describe("EventTypeSchema", () => {
  it("accepts all 15 event types", () => {
    const types = [
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
    ] satisfies EventType[];

    for (const type of types) {
      expect(EventTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects unknown event types", () => {
    expect(EventTypeSchema.safeParse("UNKNOWN_TYPE").success).toBe(false);
  });
});

describe("EventSourceSchema", () => {
  it("accepts all 4 sources", () => {
    const sources = [
      "RUNNER",
      "AGENT",
      "TOOL_GATEWAY",
      "SCORER",
    ] satisfies EventSource[];
    for (const source of sources) {
      expect(EventSourceSchema.safeParse(source).success).toBe(true);
    }
  });
});

describe("EventSchema", () => {
  it("validates a complete event with hash", () => {
    const event = createEvent();
    const result = EventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it("requires schemaVersion to be 1.0", () => {
    const event = createEvent({ schemaVersion: "2.0" as any });
    const result = EventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it("requires sequence to be positive integer", () => {
    const event = createEvent({ sequence: 0 });
    const result = EventSchema.safeParse(event);
    expect(result.success).toBe(false);

    const event2 = createEvent({ sequence: -1 });
    const result2 = EventSchema.safeParse(event2);
    expect(result2.success).toBe(false);
  });

  it("requires timestamp to be valid ISO datetime", () => {
    const event = createEvent({ timestamp: "not-a-date" });
    const result = EventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});

describe("computeHash", () => {
  it("produces deterministic hash for same event", () => {
    const event = createBaseEvent();
    const hash1 = computeHash(event);
    const hash2 = computeHash(event);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("produces different hashes for different events", () => {
    const event1 = createBaseEvent({ eventId: "evt_001" });
    const event2 = createBaseEvent({ eventId: "evt_002" });
    expect(computeHash(event1)).not.toBe(computeHash(event2));
  });

  it("includes previousHash in hash calculation", () => {
    const event1 = createBaseEvent({ previousHash: "sha256:aaa" });
    const event2 = createBaseEvent({ previousHash: "sha256:bbb" });
    expect(computeHash(event1)).not.toBe(computeHash(event2));
  });

  it("excludes hash field from canonicalization (RFC 8785)", () => {
    const base = createBaseEvent({ eventId: "evt_test" });
    const hash = computeHash(base);

    // Manually verify the hash matches canonical JSON without hash field
    const canonical = canonicalize(base);
    if (canonical === undefined)
      throw new Error("Canonicalization returned undefined");
    const expected = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    expect(hash).toBe(expected);
  });

  it("canonicalizes object keys in deterministic order (RFC 8785)", () => {
    // RFC 8785 requires lexicographic key ordering
    const eventA = createBaseEvent({
      payload: { z: 1, a: 2, m: 3 },
    });
    const eventB = createBaseEvent({
      payload: { a: 2, m: 3, z: 1 },
    });
    // Same content, different key order should produce same hash
    expect(computeHash(eventA)).toBe(computeHash(eventB));
  });

  it("canonicalizes numbers without trailing zeros (RFC 8785)", () => {
    const eventA = createBaseEvent({ payload: { value: 1.0 } });
    const eventB = createBaseEvent({ payload: { value: 1 } });
    expect(computeHash(eventA)).toBe(computeHash(eventB));
  });

  it("canonicalizes strings with proper escaping (RFC 8785)", () => {
    // RFC 8785 requires control characters to be escaped as \uXXXX or standard escapes
    // Test that a string with actual newline gets properly escaped in canonical JSON
    const event = createBaseEvent({ payload: { text: "hello\nworld" } });
    const hash = computeHash(event);
    // The canonical form should have the newline escaped as \n (literal backslash-n)
    const canonical = canonicalize(event);
    expect(canonical).toContain("hello\\nworld"); // escaped newline
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("verifyChain", () => {
  it("returns true for valid chain", () => {
    const e1 = createEvent({ sequence: 1, eventId: "evt_1" });
    const e2 = createEvent({
      sequence: 2,
      eventId: "evt_2",
      previousHash: e1.hash,
    });
    const e3 = createEvent({
      sequence: 3,
      eventId: "evt_3",
      previousHash: e2.hash,
    });

    expect(verifyChain([e1, e2, e3])).toBe(true);
  });

  it("returns true for empty array", () => {
    expect(verifyChain([])).toBe(true);
  });

  it("returns false if first event previousHash is not genesis", () => {
    const e1 = createEvent({ previousHash: "sha256:wrong" });
    expect(verifyChain([e1])).toBe(false);
  });

  it("returns false if previousHash does not match previous event hash", () => {
    const e1 = createEvent({ sequence: 1, eventId: "evt_1" });
    const e2 = createEvent({
      sequence: 2,
      eventId: "evt_2",
      previousHash: "sha256:wrong",
    });
    expect(verifyChain([e1, e2])).toBe(false);
  });

  it("returns false if event hash does not match computed hash", () => {
    const e1 = createEvent({ sequence: 1, eventId: "evt_1" });
    const e2Base = createBaseEvent({
      sequence: 2,
      eventId: "evt_2",
      previousHash: e1.hash,
    });
    const e2 = { ...e2Base, hash: "sha256:tampered" };
    expect(verifyChain([e1, e2])).toBe(false);
  });

  it("returns false if event is tampered (payload changed but hash same)", () => {
    const e1 = createEvent({
      sequence: 1,
      eventId: "evt_1",
      payload: { foo: "bar" },
    });
    const tampered = { ...e1, payload: { foo: "baz" } };
    // Hash still matches original, but payload is different
    expect(verifyChain([tampered])).toBe(false);
  });
});

describe("NDJSON writer/reader", () => {
  it("writes events to NDJSON and reads them back", () => {
    const e1 = createEvent({ sequence: 1, eventId: "evt_1" });
    const e2 = createEvent({
      sequence: 2,
      eventId: "evt_2",
      previousHash: e1.hash,
    });
    const e3 = createEvent({
      sequence: 3,
      eventId: "evt_3",
      previousHash: e2.hash,
    });

    const ndjson = writeEventsNDJSON([e1, e2, e3]);
    const events = readEventsNDJSON(ndjson);

    expect(events).toHaveLength(3);
    const e0 = events[0];
    const e1Read = events[1];
    const e2Read = events[2];
    expect(e0).toBeDefined();
    expect(e1Read).toBeDefined();
    expect(e2Read).toBeDefined();
    expect(e0!.eventId).toBe("evt_1");
    expect(e1Read!.eventId).toBe("evt_2");
    expect(e2Read!.eventId).toBe("evt_3");
  });

  it("handles empty array", () => {
    expect(writeEventsNDJSON([])).toBe("");
    expect(readEventsNDJSON("")).toEqual([]);
  });

  it("skips invalid lines with warning", () => {
    const e1 = createEvent({ sequence: 1, eventId: "evt_1" });
    const ndjson = `${writeEventsNDJSON([e1])}invalid json line\n`;
    const events = readEventsNDJSON(ndjson);
    expect(events).toHaveLength(1);
  });

  it("verifyEventsNDJSON returns valid=true for valid chain", () => {
    const e1 = createEvent({ sequence: 1, eventId: "evt_1" });
    const e2 = createEvent({
      sequence: 2,
      eventId: "evt_2",
      previousHash: e1.hash,
    });
    const ndjson = writeEventsNDJSON([e1, e2]);
    const result = verifyEventsNDJSON(ndjson);
    expect(result.valid).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });

  it("verifyEventsNDJSON returns valid=false for broken chain", () => {
    const e1 = createEvent({ sequence: 1, eventId: "evt_1" });
    const e2 = createEvent({
      sequence: 2,
      eventId: "evt_2",
      previousHash: "sha256:wrong",
    });
    const ndjson = writeEventsNDJSON([e1, e2]);
    const result = verifyEventsNDJSON(ndjson);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Hash chain verification failed");
  });

  it("verifyEventsNDJSON returns valid=true for empty", () => {
    const result = verifyEventsNDJSON("");
    expect(result.valid).toBe(true);
    expect(result.events).toEqual([]);
  });
});

describe("Event payload handling", () => {
  it("accepts arbitrary payload objects", () => {
    const event = createEvent({
      type: "TOOL_CALL",
      payload: {
        callId: "call_123",
        name: "case.read_document",
        arguments: { documentId: "doc_1", pages: [1, 2] },
      },
    });
    expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("accepts empty payload", () => {
    const event = createEvent({ payload: {} });
    expect(EventSchema.safeParse(event).success).toBe(true);
  });
});
