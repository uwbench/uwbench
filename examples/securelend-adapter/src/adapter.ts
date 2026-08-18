import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  CancelResponseSchema,
  HealthResponseSchema,
  RunRequestSchema,
  RunResponseSchema,
  RunStatusResponseSchema,
  type RunRequest,
  type RunStatus,
  type UnderwritingSubmission,
} from "@uwbench/protocol";
import { runProductChatPath, type ChatPathConfig } from "./chat-path.js";
import { protocolError, readJson, sendJson } from "./http.js";
import {
  ADAPTER_VERSION,
  type AdapterConfig,
  type McpModeConfig,
} from "./identity.js";
import { proxyToProtocolAgent } from "./protocol-proxy.js";

interface RunState {
  agentRunId: string;
  status: RunStatus;
  request: RunRequest;
  controller: AbortController;
  submission?: UnderwritingSubmission;
  error?: ReturnType<typeof protocolError>;
}

export interface SecureLendAdapterOptions {
  port: number;
  config: AdapterConfig;
  chatPath?: ChatPathConfig;
}

export class SecureLendAdapter {
  private readonly port: number;
  private readonly config: AdapterConfig;
  private readonly chatPath: ChatPathConfig | undefined;
  private readonly runs = new Map<string, RunState>();
  private readonly idempotencyKeys = new Map<string, string>();
  private server: ReturnType<typeof createServer> | null = null;
  private runCounter = 0;

  constructor(options: SecureLendAdapterOptions) {
    this.port = options.port;
    this.config = options.config;
    this.chatPath = options.chatPath ?? mcpConfigToChatPath(options.config.mcp);
  }

  get mode(): AdapterConfig["mode"] {
    return this.config.mode;
  }

  get portNumber(): number | undefined {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : undefined;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(
      request.url ?? "/",
      `http://127.0.0.1:${this.portNumber ?? this.port}`,
    );
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(
        response,
        200,
        HealthResponseSchema.parse({
          schemaVersion: "1.0",
          status: "ok",
          version: ADAPTER_VERSION,
          protocolVersion: "1.0",
          participant: this.config.participant,
        }),
      );
      return;
    }

    if (this.config.mode === "protocol") {
      const upstream = this.config.protocolUpstream;
      if (!upstream) {
        throw new Error("Protocol mode is missing SECURELEND_AGENT_URL");
      }
      await proxyToProtocolAgent(upstream, request, response);
      return;
    }

    await this.handleMcpProtocol(request, response, url);
  }

  private async handleMcpProtocol(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (request.method === "POST" && url.pathname === "/v1/runs") {
      let body: unknown;
      try {
        body = await readJson(request);
      } catch (error) {
        sendJson(
          response,
          400,
          protocolError(
            "INVALID_SUBMISSION",
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }
      const parsed = RunRequestSchema.safeParse(body);
      if (!parsed.success) {
        const unsupported =
          body &&
          typeof body === "object" &&
          "schemaVersion" in body &&
          (body as { schemaVersion?: unknown }).schemaVersion !== "1.0";
        sendJson(
          response,
          400,
          protocolError(
            unsupported ? "INVALID_SCHEMA_VERSION" : "INVALID_SUBMISSION",
            parsed.error.message,
          ),
        );
        return;
      }
      const existingId = parsed.data.idempotencyKey
        ? this.idempotencyKeys.get(parsed.data.idempotencyKey)
        : undefined;
      if (existingId && this.runs.has(existingId)) {
        sendJson(
          response,
          202,
          RunResponseSchema.parse({
            schemaVersion: "1.0",
            agentRunId: existingId,
            status: "accepted",
          }),
        );
        return;
      }

      this.runCounter += 1;
      const agentRunId = `securelend_mcp_${this.runCounter}_${Date.now()}`;
      const run: RunState = {
        agentRunId,
        status: "accepted",
        request: parsed.data,
        controller: new AbortController(),
      };
      this.runs.set(agentRunId, run);
      if (parsed.data.idempotencyKey) {
        this.idempotencyKeys.set(parsed.data.idempotencyKey, agentRunId);
      }
      void this.processMcpRun(run);
      sendJson(
        response,
        202,
        RunResponseSchema.parse({
          schemaVersion: "1.0",
          agentRunId,
          status: "accepted",
        }),
      );
      return;
    }

    const match = url.pathname.match(/^\/v1\/runs\/([^/]+)$/u);
    const agentRunId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    if (agentRunId && request.method === "GET") {
      const run = this.runs.get(agentRunId);
      if (!run) {
        sendJson(
          response,
          404,
          protocolError("RUN_NOT_FOUND", "Run not found"),
        );
        return;
      }
      sendJson(response, 200, RunStatusResponseSchema.parse(this.status(run)));
      return;
    }

    if (agentRunId && request.method === "DELETE") {
      const run = this.runs.get(agentRunId);
      if (!run) {
        sendJson(
          response,
          404,
          protocolError("RUN_NOT_FOUND", "Run not found"),
        );
        return;
      }
      if (["completed", "failed", "cancelled"].includes(run.status)) {
        sendJson(
          response,
          409,
          protocolError("INVALID_RUN_STATE", `Run is already ${run.status}`),
        );
        return;
      }
      run.controller.abort();
      run.status = "cancelled";
      sendJson(
        response,
        200,
        CancelResponseSchema.parse({
          schemaVersion: "1.0",
          agentRunId,
          cancelled: true,
        }),
      );
      return;
    }

    sendJson(response, 404, protocolError("RUN_NOT_FOUND", "Route not found"));
  }

  private status(run: RunState): unknown {
    const base = {
      schemaVersion: "1.0" as const,
      agentRunId: run.agentRunId,
      status: run.status,
    };
    if (run.status === "completed") return { ...base, result: run.submission };
    if (run.status === "failed") return { ...base, error: run.error };
    return base;
  }

  private async processMcpRun(run: RunState): Promise<void> {
    if (!this.chatPath) {
      run.status = "failed";
      run.error = protocolError(
        "AGENT_CRASHED",
        "MCP mode is missing chat-path configuration",
      );
      return;
    }
    run.status = "running";
    try {
      const result = await runProductChatPath(
        run.request,
        this.chatPath,
        run.controller.signal,
      );
      if (this.runs.get(run.agentRunId)?.status === "cancelled") return;
      run.submission = result.submission;
      run.status = "completed";
    } catch (error) {
      if (
        this.runs.get(run.agentRunId)?.status === "cancelled" ||
        isAbortError(error)
      ) {
        run.status = "cancelled";
        return;
      }
      run.error = protocolError(
        "AGENT_CRASHED",
        error instanceof Error ? error.message : String(error),
      );
      run.status = "failed";
    }
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          sendJson(
            response,
            502,
            protocolError(
              "AGENT_CRASHED",
              error instanceof Error
                ? error.message
                : "SecureLend adapter request failed",
            ),
          );
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1");
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    for (const run of this.runs.values()) {
      if (!["completed", "failed", "cancelled"].includes(run.status)) {
        run.controller.abort();
        run.status = "cancelled";
      }
    }
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function mcpConfigToChatPath(
  mcp: McpModeConfig | undefined,
): ChatPathConfig | undefined {
  if (!mcp) return undefined;
  return {
    mcpUrl: mcp.url,
    token: mcp.token,
    pollIntervalMs: mcp.pollIntervalMs,
    pollTimeoutMs: mcp.pollTimeoutMs,
    ...(mcp.documentApiUrl ? { documentApiUrl: mcp.documentApiUrl } : {}),
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}
