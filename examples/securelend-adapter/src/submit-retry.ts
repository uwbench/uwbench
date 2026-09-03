/**
 * Light spacing / retry for live submit_documents 429 and IP rate limits.
 * Tests use 10–20ms polls and must not sleep.
 */

export const SUBMIT_RATE_LIMIT_ATTEMPTS = 5;

export function isSubmitRateLimited(error: unknown): boolean {
  const blob = stringifyUnknown(error).toLowerCase();
  return (
    /\b429\b/.test(blob) ||
    /too many requests/.test(blob) ||
    /rate[- ]?limit/.test(blob) ||
    /try again later/.test(blob) ||
    /failed to reserve upload url/.test(blob)
  );
}

export function submitRetryDelayMs(
  attempt: number,
  pollIntervalMs: number,
): number {
  if (pollIntervalMs < 500) return 0;
  const base = Math.min(Math.max(pollIntervalMs, 1_000), 2_000);
  return Math.min(base * 2 ** attempt, 16_000);
}

/** Gap between successful submit_documents calls on a live run. */
export function submitSpacingMs(pollIntervalMs: number): number {
  if (pollIntervalMs < 500) return 0;
  return Math.min(pollIntervalMs, 1_000);
}

export async function callWithSubmitRetry<T>(
  operation: () => Promise<T>,
  options: {
    pollIntervalMs: number;
    sleep: (ms: number) => Promise<void>;
    attempts?: number;
  },
): Promise<T> {
  const attempts = options.attempts ?? SUBMIT_RATE_LIMIT_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSubmitRateLimited(error) || attempt === attempts - 1) {
        throw error;
      }
      const delay = submitRetryDelayMs(attempt, options.pollIntervalMs);
      if (delay > 0) await options.sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) {
    const extra =
      "data" in value && value.data !== undefined
        ? ` ${stringifyUnknown(value.data)}`
        : "";
    return `${value.message}${extra}`;
  }
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
