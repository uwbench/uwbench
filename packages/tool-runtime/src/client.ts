import { randomUUID } from "node:crypto";
import {
  TOOL_NAMES,
  ToolFailureResultSchema,
  ToolResultSchema,
  isValidToolName,
  type ToolName,
} from "@uwbench/protocol";

const TRANSIENT_STATUS = new Set([500, 502, 503, 504]);
const TRANSIENT_CODES = new Set(["INTERNAL_ERROR", "UNAVAILABLE", "TIMEOUT"]);

export class ToolClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly callId?: string;
  readonly toolName?: string;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      callId?: string;
      name?: string;
    } = {},
  ) {
    super(message);
    this.name = "ToolClientError";
    this.code = code;
    this.retryable = options.retryable === true;
    if (options.callId !== undefined) this.callId = options.callId;
    if (options.name !== undefined) this.toolName = options.name;
  }
}

export interface ToolCallRecord {
  callId: string;
  name: ToolName;
  arguments: Record<string, unknown>;
  cached: boolean;
  attempt: number;
}

export interface ToolClientOptions {
  url: string;
  bearerToken: string;
  advertisedTools?: readonly string[];
  maxToolCalls?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export type ToolCallOutcome =
  | {
      ok: true;
      result: Record<string, unknown>;
      callId: string;
      name: ToolName;
    }
  | { ok: false; error: ToolClientError };

export class ToolClient {
  readonly url: string;
  readonly advertisedTools: ReadonlySet<string>;
  readonly maxToolCalls: number;
  readonly calls: ToolCallRecord[] = [];

  private readonly bearerToken: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<
    string,
    { name: ToolName; result: Record<string, unknown> }
  >();
  private executedCallIds = new Set<string>();

  constructor(options: ToolClientOptions) {
    if (!options.url) throw new Error("ToolClient requires a gateway URL");
    if (!options.bearerToken) {
      throw new Error("ToolClient requires a run-scoped bearer token");
    }
    this.url = options.url;
    this.bearerToken = options.bearerToken;
    this.advertisedTools = new Set(options.advertisedTools ?? TOOL_NAMES);
    this.maxToolCalls = options.maxToolCalls ?? 100;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 25;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  usedTools(): ToolName[] {
    return [...new Set(this.calls.map((call) => call.name))];
  }

  async call(
    name: ToolName,
    toolArguments: Record<string, unknown> = {},
    options: { callId?: string } = {},
  ): Promise<Record<string, unknown>> {
    const outcome = await this.tryCall(name, toolArguments, options);
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  }

  async tryCall(
    name: ToolName,
    toolArguments: Record<string, unknown> = {},
    options: { callId?: string } = {},
  ): Promise<ToolCallOutcome> {
    try {
      const result = await this.execute(name, toolArguments, options.callId);
      return { ok: true, result: result.result, callId: result.callId, name };
    } catch (error) {
      const clientError =
        error instanceof ToolClientError
          ? error
          : new ToolClientError(
              "INTERNAL_ERROR",
              error instanceof Error ? error.message : String(error),
              { name },
            );
      return { ok: false, error: clientError };
    }
  }

  private async execute(
    name: ToolName,
    toolArguments: Record<string, unknown>,
    requestedCallId?: string,
  ): Promise<{ callId: string; result: Record<string, unknown> }> {
    if (!isValidToolName(name) || !this.advertisedTools.has(name)) {
      throw new ToolClientError(
        "UNAUTHORIZED_TOOL",
        `Tool ${name} is not advertised for this run`,
        { name },
      );
    }

    const callId = requestedCallId ?? `call_${randomUUID()}`;
    const cached = this.cache.get(callId);
    if (cached) {
      this.calls.push({
        callId,
        name,
        arguments: toolArguments,
        cached: true,
        attempt: 0,
      });
      return { callId, result: cached.result };
    }

    if (
      !this.executedCallIds.has(callId) &&
      this.executedCallIds.size >= this.maxToolCalls
    ) {
      throw new ToolClientError(
        "BUDGET_EXCEEDED",
        `Client tool-call budget exceeded (${this.maxToolCalls})`,
        { callId, name },
      );
    }

    let lastError: ToolClientError | undefined;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      this.calls.push({
        callId,
        name,
        arguments: toolArguments,
        cached: false,
        attempt,
      });
      try {
        const result = await this.invoke(callId, name, toolArguments);
        this.executedCallIds.add(callId);
        this.cache.set(callId, { name, result });
        return { callId, result };
      } catch (error) {
        lastError =
          error instanceof ToolClientError
            ? error
            : new ToolClientError(
                "INTERNAL_ERROR",
                error instanceof Error ? error.message : String(error),
                { callId, name, retryable: true },
              );
        if (!lastError.retryable || attempt > this.maxRetries) break;
        await delay(this.retryDelayMs * attempt);
      }
    }
    throw (
      lastError ?? new ToolClientError("INTERNAL_ERROR", "Tool call failed")
    );
  }

  private async invoke(
    callId: string,
    name: ToolName,
    toolArguments: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.bearerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "1.0",
          callId,
          name,
          arguments: toolArguments,
        }),
      });
    } catch (error) {
      throw new ToolClientError(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Gateway fetch failed",
        { callId, name, retryable: true },
      );
    }

    const body: unknown = await response.json().catch(() => undefined);
    const parsed = ToolResultSchema.safeParse(body);
    if (parsed.success) {
      if (parsed.data.ok === true) {
        return (parsed.data as { result: Record<string, unknown> }).result;
      }
      const failure = ToolFailureResultSchema.parse(parsed.data);
      throw new ToolClientError(failure.error.code, failure.error.message, {
        callId,
        name,
        retryable: TRANSIENT_CODES.has(failure.error.code),
      });
    }

    const gateway = body as { code?: string; message?: string } | undefined;
    const code = gateway?.code ?? `HTTP_${response.status}`;
    throw new ToolClientError(
      code,
      gateway?.message ?? `Gateway returned HTTP ${response.status}`,
      {
        callId,
        name,
        retryable: TRANSIENT_STATUS.has(response.status),
      },
    );
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
