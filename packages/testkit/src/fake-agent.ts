import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  type ProtocolError,
  type RunRequest,
  type RunStatus,
  HealthResponseSchema,
  RunRequestSchema,
  RunStatusResponseSchema,
  CancelResponseSchema,
} from "@uwbench/protocol";

export type FakeAgentBehavior =
  | "complete"
  | "fail"
  | "running"
  | "awaitingTool"
  | "timeout"
  | "idempotent"
  | "rejectUnknownVersion"
  | "oversizedOutput"
  | "invalidSchema"
  | "restartDuringRun";

export interface FakeAgentConfig {
  baseUrl: string;
  port?: number | undefined;
  behavior?: FakeAgentBehavior | undefined;
  submission?: Record<string, unknown> | undefined;
  timeoutMs?: number | undefined;
  error?: ProtocolError | undefined;
  oversizedOutput?: string | undefined;
  invalidSubmission?: unknown | undefined;
}

interface RunState {
  agentRunId: string;
  status: RunStatus;
  request: RunRequest;
  createdAt: number;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  submission?: Record<string, unknown> | undefined;
  error?: ProtocolError | undefined;
  timeoutHandle?: ReturnType<typeof setTimeout> | undefined;
  behavior: FakeAgentBehavior;
}

export class FakeAgent {
  private app: Express;
  private server: ReturnType<Express["listen"]> | null = null;
  private runs = new Map<string, RunState>();
  private config: FakeAgentConfig & {
    behavior: FakeAgentBehavior;
    submission: Record<string, unknown>;
    timeoutMs: number;
    oversizedOutput: string;
    invalidSubmission: unknown;
  };
  private idempotencyKeys = new Map<string, string>(); // idempotencyKey -> agentRunId
  private runCounter = 0;
  private port: number;

  constructor(config: FakeAgentConfig) {
    // Extract port from baseUrl if not explicitly provided
    let port = config.port;
    if (!port && config.baseUrl) {
      try {
        const url = new URL(config.baseUrl);
        port = parseInt(url.port || "9090", 10);
      } catch {
        port = 9090;
      }
    }
    this.port = port ?? 9090;
    const defaultBehavior: FakeAgentBehavior = "complete";
    this.config = {
      baseUrl: config.baseUrl,
      port: this.port,
      behavior: config.behavior ?? defaultBehavior,
      submission: config.submission ?? createDefaultSubmission(),
      timeoutMs: config.timeoutMs ?? 5000,
      oversizedOutput: config.oversizedOutput ?? "x".repeat(6_000_000),
      invalidSubmission: config.invalidSubmission ?? { invalid: true },
      ...(config.error ? { error: config.error } : {}),
    };

    this.app = express();
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(
      (err: Error, _req: Request, res: Response, _next: NextFunction) => {
        if (
          err instanceof SyntaxError &&
          "status" in err &&
          err.status === 400 &&
          "body" in err
        ) {
          return res.status(400).json({
            schemaVersion: "1.0",
            code: "INVALID_SUBMISSION",
            message: "Malformed JSON",
            requestId: `req-${Date.now()}`,
          });
        }
        return res.status(500).json({
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: "Internal server error",
          requestId: `req-${Date.now()}`,
        });
      },
    );

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // GET /health
    this.app.get("/health", (_req: Request, res: Response) => {
      const health = {
        schemaVersion: "1.0" as const,
        status: "ok" as const,
        version: "0.0.0-test",
        protocolVersion: "1.0" as const,
      };
      const parsed = HealthResponseSchema.safeParse(health);
      if (!parsed.success) {
        return res.status(500).json({
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: "Health response validation failed",
          requestId: `req-${Date.now()}`,
        });
      }
      res.json(parsed.data);
      return;
    });

    // POST /v1/runs
    this.app.post("/v1/runs", async (req: Request, res: Response) => {
      try {
        // Validate request
        const parsedRequest = RunRequestSchema.safeParse(req.body);
        if (!parsedRequest.success) {
          const isUnsupportedVersion =
            typeof req.body === "object" &&
            req.body !== null &&
            "schemaVersion" in req.body &&
            req.body.schemaVersion !== "1.0";
          return res.status(400).json({
            schemaVersion: "1.0",
            code: isUnsupportedVersion
              ? "INVALID_SCHEMA_VERSION"
              : "INVALID_SUBMISSION",
            message: `Invalid request: ${parsedRequest.error.message}`,
            requestId: `req-${Date.now()}`,
          });
        }

        const request = parsedRequest.data;

        // Check schema version
        if (request.schemaVersion !== "1.0") {
          return res.status(400).json({
            schemaVersion: "1.0",
            code: "INVALID_SCHEMA_VERSION",
            message: `Unsupported schema version: ${request.schemaVersion}`,
            requestId: `req-${Date.now()}`,
          });
        }

        // Check idempotency
        if (request.idempotencyKey) {
          const existingRunId = this.idempotencyKeys.get(
            request.idempotencyKey,
          );
          if (existingRunId) {
            const existingRun = this.runs.get(existingRunId);
            if (existingRun) {
              return res.status(202).json({
                schemaVersion: "1.0",
                agentRunId: existingRunId,
                status: "accepted" as const,
              });
            }
          }
        }

        // Create new run
        this.runCounter++;
        const agentRunId = `agent_run_${this.runCounter}_${Date.now()}`;

        const runState: RunState = {
          agentRunId,
          status: "accepted",
          request,
          createdAt: Date.now(),
          behavior: this.config.behavior,
        };

        this.runs.set(agentRunId, runState);
        if (request.idempotencyKey) {
          this.idempotencyKeys.set(request.idempotencyKey, agentRunId);
        }

        // Start async processing based on behavior
        this.processRun(agentRunId);

        return res.status(202).json({
          schemaVersion: "1.0",
          agentRunId,
          status: "accepted" as const,
        });
      } catch (error) {
        return res.status(500).json({
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
          requestId: `req-${Date.now()}`,
        });
      }
    });

    // GET /v1/runs/:agentRunId
    this.app.get("/v1/runs/:agentRunId", (req: Request, res: Response) => {
      const { agentRunId } = req.params;
      if (!agentRunId) {
        return res.status(400).json({
          schemaVersion: "1.0",
          code: "INVALID_SCHEMA_VERSION",
          message: "Missing agentRunId parameter",
          requestId: `req-${Date.now()}`,
        });
      }
      const run = this.runs.get(agentRunId);

      if (!run) {
        return res.status(404).json({
          schemaVersion: "1.0",
          code: "RUN_NOT_FOUND",
          message: `Run not found: ${agentRunId}`,
          requestId: `req-${Date.now()}`,
        });
      }

      const response = this.buildStatusResponse(run);
      const parsed = RunStatusResponseSchema.safeParse(response);
      if (!parsed.success) {
        return res.status(500).json({
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: `Status response validation failed: ${parsed.error.message}`,
          requestId: `req-${Date.now()}`,
        });
      }

      res.json(parsed.data);
      return;
    });

    // DELETE /v1/runs/:agentRunId
    this.app.delete("/v1/runs/:agentRunId", (req: Request, res: Response) => {
      const { agentRunId } = req.params;
      if (!agentRunId) {
        return res.status(400).json({
          schemaVersion: "1.0",
          code: "INVALID_SCHEMA_VERSION",
          message: "Missing agentRunId parameter",
          requestId: `req-${Date.now()}`,
        });
      }
      const run = this.runs.get(agentRunId);

      if (!run) {
        return res.status(404).json({
          schemaVersion: "1.0",
          code: "RUN_NOT_FOUND",
          message: `Run not found: ${agentRunId}`,
          requestId: `req-${Date.now()}`,
        });
      }

      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "cancelled"
      ) {
        return res.status(409).json({
          schemaVersion: "1.0",
          code: "INVALID_RUN_STATE",
          message: `Run is already terminal: ${run.status}`,
          requestId: `req-${Date.now()}`,
        });
      }

      // Clear any timeout
      if (run.timeoutHandle) {
        clearTimeout(run.timeoutHandle);
      }

      // Update status to cancelled
      run.status = "cancelled";
      run.completedAt = Date.now();

      const response = {
        schemaVersion: "1.0" as const,
        agentRunId,
        cancelled: true as const,
      };

      const parsed = CancelResponseSchema.safeParse(response);
      if (!parsed.success) {
        return res.status(500).json({
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: `Cancel response validation failed: ${parsed.error.message}`,
          requestId: `req-${Date.now()}`,
        });
      }

      res.json(parsed.data);
      return;
    });
  }

  private processRun(agentRunId: string): void {
    const run = this.runs.get(agentRunId);
    if (!run) return;

    const { behavior } = run;

    switch (behavior) {
      case "complete": {
        run.status = "running";
        run.startedAt = Date.now();

        run.timeoutHandle = setTimeout(() => {
          run.status = "completed";
          run.completedAt = Date.now();
          run.submission = this.config.submission;
        }, 200);
        break;
      }

      case "fail": {
        run.status = "running";
        run.startedAt = Date.now();

        run.timeoutHandle = setTimeout(() => {
          run.status = "failed";
          run.completedAt = Date.now();
          run.error = this.config.error;
        }, 200);
        break;
      }

      case "running": {
        run.status = "running";
        run.startedAt = Date.now();
        // Stay running indefinitely until cancelled
        break;
      }

      case "awaitingTool": {
        run.status = "running";
        run.startedAt = Date.now();

        run.timeoutHandle = setTimeout(() => {
          run.status = "awaiting_tool";
        }, 100);
        break;
      }

      case "timeout": {
        run.status = "running";
        run.startedAt = Date.now();

        run.timeoutHandle = setTimeout(() => {
          run.status = "failed";
          run.completedAt = Date.now();
        }, this.config.timeoutMs);
        break;
      }

      case "idempotent": {
        // Same as complete but idempotency is handled at request level
        run.status = "running";
        run.startedAt = Date.now();

        run.timeoutHandle = setTimeout(() => {
          run.status = "completed";
          run.completedAt = Date.now();
          run.submission = this.config.submission;
        }, 200);
        break;
      }

      case "rejectUnknownVersion": {
        // This is handled at request validation level
        run.status = "failed";
        run.completedAt = Date.now();
        break;
      }

      case "oversizedOutput": {
        run.status = "running";
        run.startedAt = Date.now();

        run.timeoutHandle = setTimeout(() => {
          run.status = "failed";
          run.completedAt = Date.now();
        }, 200);
        break;
      }

      case "invalidSchema": {
        run.status = "running";
        run.startedAt = Date.now();

        run.timeoutHandle = setTimeout(() => {
          run.status = "failed";
          run.completedAt = Date.now();
        }, 200);
        break;
      }

      case "restartDuringRun": {
        run.status = "running";
        run.startedAt = Date.now();
        // The run will be interrupted when the agent is stopped/restarted
        break;
      }
    }
  }

  private buildStatusResponse(run: RunState) {
    const base = {
      schemaVersion: "1.0" as const,
      agentRunId: run.agentRunId,
      status: run.status,
    };

    switch (run.status) {
      case "accepted":
      case "running":
      case "awaiting_tool":
        return base;

      case "completed":
        return {
          ...base,
          result: run.submission ?? this.config.submission,
        };

      case "failed": {
        if (run.error) {
          return { ...base, error: run.error };
        }
        let errorCode = "AGENT_CRASHED";
        let errorMessage = "Simulated agent failure";
        switch (run.behavior) {
          case "timeout":
            errorCode = "AGENT_TIMEOUT";
            errorMessage = "Agent exceeded wall-clock time limit";
            break;
          case "oversizedOutput":
            errorCode = "BUDGET_EXCEEDED";
            errorMessage = "Output exceeds maxOutputBytes limit";
            break;
          case "invalidSchema":
            errorCode = "INVALID_SUBMISSION";
            errorMessage =
              "Submission does not conform to UnderwritingSubmission schema";
            break;
          case "fail":
            errorCode = "AGENT_CRASHED";
            errorMessage = "Simulated agent failure";
            break;
        }
        return {
          ...base,
          error: {
            schemaVersion: "1.0",
            code: errorCode,
            message: errorMessage,
            requestId: `req-${Date.now()}`,
          },
        };
      }

      case "cancelled":
        return base;

      default:
        return base;
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.port);
      server.once("listening", () => {
        this.server = server;
        resolve();
      });
      server.once("error", reject);
    });
  }

  async stop(): Promise<void> {
    // Clear all timeouts and mark non-terminal runs as failed
    for (const run of this.runs.values()) {
      if (run.timeoutHandle) {
        clearTimeout(run.timeoutHandle);
      }
      // Mark non-terminal runs as failed (agent crashed/restarted)
      if (
        run.status !== "completed" &&
        run.status !== "failed" &&
        run.status !== "cancelled"
      ) {
        run.status = "failed";
        run.completedAt = Date.now();
        run.error = {
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message: "Agent stopped or restarted",
          requestId: `req-${Date.now()}`,
        };
      }
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }

  getRuns(): Map<string, RunState> {
    return new Map(this.runs);
  }

  getRun(agentRunId: string): RunState | undefined {
    return this.runs.get(agentRunId);
  }
}

function createDefaultSubmission(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    financialSpread: {
      revenue: { amount: 1000000, currency: "USD" },
      period: { start: "2024-01-01", end: "2024-12-31" },
      currency: "USD",
      scale: "units",
      signConvention: "positive_revenue_negative_expense",
    },
    normalizedFacts: [],
    risks: [],
    discrepancies: [],
    complianceFindings: [],
    followUpRequests: [],
    policyAssessment: {
      applicableRules: [],
      evaluations: [],
    },
    recommendation: {
      decision: "INSUFFICIENT_INFORMATION",
      confidence: 0.5,
      conditions: [],
      policyExceptions: [],
      rationale: [],
    },
    memo: {
      markdown: "Test memo",
      claims: [],
    },
    confidence: {
      overall: 0.5,
      byComponent: {},
    },
  };
}
