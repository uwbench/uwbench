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
  type ProtocolError,
  type RunRequest,
  type RunStatus,
  type UnderwritingSubmission,
} from "../../../packages/protocol/dist/index.js";
import {
  buildPrompt,
  createInsufficientSubmission,
  parseSubmission,
  type GenerationMetadata,
  type SinglePromptConfig,
} from "./agent-core.js";
import { createLLMClient, type LLMClient } from "./llm-client.js";

interface RunState {
  agentRunId: string;
  status: RunStatus;
  request: RunRequest;
  submission?: UnderwritingSubmission;
  error?: ProtocolError;
}

export interface RealAgentConfig {
  port: number;
  llmConfig: SinglePromptConfig;
  llmClient?: LLMClient;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 10_000_000)
      throw new Error("Request body exceeds 10 MB");
  }
  return JSON.parse(body);
}

function protocolError(
  code: ProtocolError["code"],
  message: string,
): ProtocolError {
  return { schemaVersion: "1.0", code, message, requestId: "single-prompt" };
}

export class RealSinglePromptAgent {
  private readonly runs = new Map<string, RunState>();
  private readonly idempotencyKeys = new Map<string, string>();
  private readonly llmClient: LLMClient;
  private server: ReturnType<typeof createServer> | null = null;
  private runCounter = 0;

  constructor(private readonly config: RealAgentConfig) {
    this.llmClient = config.llmClient ?? createLLMClient(config.llmConfig);
  }

  private status(run: RunState): unknown {
    const base = {
      schemaVersion: "1.0",
      agentRunId: run.agentRunId,
      status: run.status,
    };
    if (run.status === "completed") return { ...base, result: run.submission };
    if (run.status === "failed") return { ...base, error: run.error };
    return base;
  }

  private async processRun(run: RunState): Promise<void> {
    run.status = "running";
    try {
      const context = {
        caseId: run.request.caseId,
        objective: run.request.objective,
        requiredOutputs: run.request.requiredOutputs,
        lane: run.request.lane,
      };
      const result = await this.llmClient.generate(
        buildPrompt(context),
        this.config.llmConfig,
      );
      const submission =
        result.text === "__UWBench_mock_insufficient__"
          ? createInsufficientSubmission(context, result.metadata)
          : this.withUsage(parseSubmission(result.text), result.metadata);
      if (this.runs.get(run.agentRunId)?.status === "cancelled") return;
      run.submission = submission;
      run.status = "completed";
    } catch (error) {
      if (this.runs.get(run.agentRunId)?.status === "cancelled") return;
      run.error = protocolError(
        "AGENT_CRASHED",
        error instanceof Error ? error.message : String(error),
      );
      run.status = "failed";
    }
  }

  private withUsage(
    submission: UnderwritingSubmission,
    metadata: GenerationMetadata,
  ): UnderwritingSubmission {
    return {
      ...submission,
      usage: {
        inputTokens: metadata.inputTokens,
        outputTokens: metadata.outputTokens,
        providerReportedCostUsd: submission.usage?.providerReportedCostUsd,
      },
      memo: {
        ...submission.memo,
        markdown: `${submission.memo.markdown}\n\nRuntime: ${metadata.promptVersion}; ${metadata.provider}@${metadata.providerVersion}; ${metadata.model}@${metadata.modelVersion}`,
      },
    };
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(
      request.url ?? "/",
      `http://127.0.0.1:${this.config.port}`,
    );
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(
        response,
        200,
        HealthResponseSchema.parse({
          schemaVersion: "1.0",
          status: "ok",
          version: "0.1.0-single-prompt",
          protocolVersion: "1.0",
        }),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/runs") {
      const body = await readJson(request);
      const parsed = RunRequestSchema.safeParse(body);
      if (!parsed.success) {
        const code =
          (body as { schemaVersion?: unknown } | null)?.schemaVersion !== "1.0"
            ? "INVALID_SCHEMA_VERSION"
            : "INVALID_SUBMISSION";
        sendJson(response, 400, protocolError(code, parsed.error.message));
        return;
      }
      const key = parsed.data.idempotencyKey;
      const existing = key ? this.idempotencyKeys.get(key) : undefined;
      if (existing) {
        sendJson(
          response,
          202,
          RunResponseSchema.parse({
            schemaVersion: "1.0",
            agentRunId: existing,
            status: "accepted",
          }),
        );
        return;
      }
      const agentRunId = `single_prompt_${++this.runCounter}`;
      const run: RunState = {
        agentRunId,
        status: "accepted",
        request: parsed.data,
      };
      this.runs.set(agentRunId, run);
      if (key) this.idempotencyKeys.set(key, agentRunId);
      void this.processRun(run);
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
    const id = url.pathname.match(/^\/v1\/runs\/([^/]+)$/u)?.[1];
    const run = id ? this.runs.get(decodeURIComponent(id)) : undefined;
    if (!run) {
      sendJson(response, 404, protocolError("RUN_NOT_FOUND", "Run not found"));
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, RunStatusResponseSchema.parse(this.status(run)));
      return;
    }
    if (
      request.method === "DELETE" &&
      !["completed", "failed", "cancelled"].includes(run.status)
    ) {
      run.status = "cancelled";
      sendJson(
        response,
        200,
        CancelResponseSchema.parse({
          schemaVersion: "1.0",
          agentRunId: run.agentRunId,
          cancelled: true,
        }),
      );
      return;
    }
    sendJson(
      response,
      409,
      protocolError("INVALID_RUN_STATE", `Run is already ${run.status}`),
    );
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        sendJson(
          response,
          400,
          protocolError(
            "INVALID_SUBMISSION",
            error instanceof Error ? error.message : String(error),
          ),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(this.config.port, "127.0.0.1");
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
