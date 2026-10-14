import { describe, expect, it } from "vitest";
import {
  callWithSubmitRetry,
  isSubmitRateLimited,
  submitRetryDelayMs,
  submitSpacingMs,
} from "./submit-retry.js";

describe("submit_documents rate-limit retry", () => {
  it("detects 429 and IP-limit bodies without task ids", () => {
    expect(isSubmitRateLimited("HTTP 429")).toBe(true);
    expect(
      isSubmitRateLimited(
        "Failed to reserve upload URL: INTERNAL_SERVER_ERROR: Too many requests from this IP, please try again later",
      ),
    ).toBe(true);
    expect(isSubmitRateLimited(new Error("rate-limited"))).toBe(true);
    expect(isSubmitRateLimited("document already exists")).toBe(false);
  });

  it("does not sleep on test-speed polls", () => {
    expect(submitSpacingMs(10)).toBe(0);
    expect(submitRetryDelayMs(0, 20)).toBe(0);
    expect(submitSpacingMs(2_000)).toBe(1_000);
    expect(submitRetryDelayMs(0, 2_000)).toBe(2_000);
    expect(submitRetryDelayMs(3, 2_000)).toBe(16_000);
  });

  it("retries a rate-limited submit then succeeds", async () => {
    const slept: number[] = [];
    let calls = 0;
    const result = await callWithSubmitRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("Too many requests from this IP");
        }
        return "ok";
      },
      {
        pollIntervalMs: 10,
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(slept).toEqual([]);
  });

  it("rethrows a non-rate-limit error on the first attempt", async () => {
    await expect(
      callWithSubmitRetry(
        async () => {
          throw new Error("schema validation failed");
        },
        { pollIntervalMs: 2_000, sleep: async () => undefined },
      ),
    ).rejects.toThrow(/schema validation failed/);
  });
});
