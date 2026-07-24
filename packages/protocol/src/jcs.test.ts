import { describe, expect, it } from "vitest";
import { canonicalizeJcs } from "./jcs.js";
import { EventSchema } from "./events.js";

describe("RFC 8785 JSON canonicalization", () => {
  it("sorts integer-like keys lexically instead of by JavaScript property order", () => {
    expect(canonicalizeJcs({ "2": "two", "10": "ten", "1": "one" })).toBe(
      '{"1":"one","10":"ten","2":"two"}',
    );
  });

  it("sorts Unicode property names by UTF-16 code units", () => {
    expect(
      canonicalizeJcs({
        "\u20ac": "Euro Sign",
        "\r": "Carriage Return",
        "\ud83d\ude00": "Emoji",
        "1": "One",
        "\u00f6": "Latin",
        "\u0080": "Control",
      }),
    ).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji"}',
    );
  });

  it("uses ECMAScript's RFC 8785 number serialization", () => {
    expect(
      canonicalizeJcs([Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27]),
    ).toBe("[333333333.3333333,1e+30,4.5,0.002,1e-27]");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite number %s",
    (value) => {
      expect(() => canonicalizeJcs({ value })).toThrow(
        "JCS rejects non-finite numbers",
      );
      expect(
        EventSchema.safeParse({
          schemaVersion: "1.0",
          eventId: "evt_1",
          runId: "run_1",
          caseId: "case_1",
          sequence: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          source: "RUNNER",
          type: "RUN_STARTED",
          payload: { value },
          previousHash: "sha256:genesis",
          hash: "sha256:placeholder",
        }).success,
      ).toBe(false);
    },
  );

  it("rejects non-I-JSON values and unpaired surrogates", () => {
    expect(() => canonicalizeJcs({ value: undefined })).toThrow();
    expect(() => canonicalizeJcs({ value: 1n })).toThrow();
    expect(() => canonicalizeJcs("\ud800")).toThrow(
      "JCS rejects unpaired high surrogates",
    );
  });
});
