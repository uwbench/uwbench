import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { validateCaseSync } from "@uwbench/case-schema";
import { computeHash, type EventWithoutHash } from "@uwbench/protocol";
import {
  LocalRunner,
  createParticipantView,
  verifyRun,
  type Budget,
  createInitialBudgetState,
  enforceBudget,
  checkBudgetViolation,
} from "../index.js";

// Test helpers
function createTempCase(caseOverrides: Record<string, unknown> = {}): string {
  const tempDir = join(tmpdir(), `uwbench-test-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });

  const defaultCase = {
    schema_version: "1.0",
    case_id: "case-00001",
    track: "commercial-credit",
    benchmark_version: "0.1.0",
    jurisdiction: "US",
    as_of_date: "2025-12-31",
    currency: "USD",
    requested_product: "term_loan",
    requested_amount: 1000000,
    supported_lanes: ["reasoning_only"],
    features: {
      missing_information: true,
      conflicting_information: false,
      fraud_signal: false,
    },
    budgets: {
      max_duration_seconds: 900,
      max_tool_calls: 100,
    },
    ...caseOverrides,
  };

  const yaml = Object.entries(defaultCase)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((v) => `  - ${v}`).join("\n")}`;
      } else if (typeof value === "object" && value !== null) {
        return `${key}:\n${Object.entries(value)
          .map(([k, v]) => `  ${k}: ${typeof v === "string" ? `"${v}"` : v}`)
          .join("\n")}`;
      } else if (typeof value === "string") {
        return `${key}: "${value}"`;
      } else {
        return `${key}: ${value}`;
      }
    })
    .join("\n");

  writeFileSync(join(tempDir, "case.yaml"), yaml);
  mkdirSync(join(tempDir, "inputs", "documents"), { recursive: true });
  mkdirSync(join(tempDir, "inputs", "records"), { recursive: true });
  mkdirSync(join(tempDir, "inputs", "policy"), { recursive: true });
  mkdirSync(join(tempDir, "environment"), { recursive: true });
  mkdirSync(join(tempDir, "normalized"), { recursive: true });
  writeFileSync(join(tempDir, "normalized", "canonical-input.json"), "{}");
  writeFileSync(
    join(tempDir, "environment", "tool-fixtures.json"),
    JSON.stringify({
      documents: [],
      records: [],
      policies: [],
      information: {},
    }),
  );
  writeFileSync(
    join(tempDir, "environment", "scenario.yaml"),
    "initial_state: start\ntransitions: []",
  );
  writeFileSync(
    join(tempDir, "task.md"),
    "## Objective\nUnderwrite the test borrower.\n\n## Required Outputs\n- Financial spread\n- Risk findings\n- Policy assessment\n- Recommendation\n- Credit memo\n",
  );

  return tempDir;
}

function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function refreshChecksum(runDir: string, file: string): void {
  const checksumsPath = join(runDir, "checksums.json");
  const checksums = JSON.parse(readFileSync(checksumsPath, "utf8"));
  checksums.files[file] = `sha256:${createHash("sha256")
    .update(readFileSync(join(runDir, file)))
    .digest("hex")}`;
  writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2));
}

// Mock agent server
let mockAgentServer: (() => void) | null = null;
let mockAgentUrl = "";
let mockDeleteCount = 0;
let mockStartedRunCount = 0;

async function startMockAgent(
  behavior: "complete" | "fail" | "running" | "invalid" = "complete",
): Promise<string> {
  // Use a simple HTTP server for mocking
  const { createServer } = await import("node:http");
  const { URL } = await import("node:url");

  const port = 9090 + Math.floor(Math.random() * 1000);
  mockAgentUrl = `http://127.0.0.1:${port}`;

  interface MockRun {
    status: string;
    submission?: unknown;
    error?: unknown;
    idempotencyKey?: string;
  }
  const runs = new Map<string, MockRun>();
  let runCounter = 0;
  mockDeleteCount = 0;
  mockStartedRunCount = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "", `http://127.0.0.1:${port}`);

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          schemaVersion: "1.0",
          status: "ok",
          version: "0.0.0-test",
          protocolVersion: "1.0",
        }),
      );
      return;
    }

    if (url.pathname === "/v1/runs" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);

      // Check idempotency
      if (request.idempotencyKey) {
        for (const [id, run] of runs) {
          if ((run as any).idempotencyKey === request.idempotencyKey) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                schemaVersion: "1.0",
                agentRunId: id,
                status: "accepted",
              }),
            );
            return;
          }
        }
      }

      runCounter++;
      mockStartedRunCount++;
      const agentRunId = `agent_run_${runCounter}`;

      if (behavior === "complete" || behavior === "invalid") {
        // Complete synchronously for faster tests
        runs.set(agentRunId, {
          status: "completed",
          idempotencyKey: request.idempotencyKey,
          submission:
            behavior === "invalid"
              ? { invalid: true }
              : {
                  schemaVersion: "1.0",
                  financialSpread: {
                    revenue: { amount: 1000000, currency: "USD" },
                    period: { start: "2025-01-01", end: "2025-12-31" },
                    currency: "USD",
                    scale: "units",
                    signConvention: "positive_revenue_negative_expense",
                  },
                  normalizedFacts: [],
                  risks: [],
                  discrepancies: [],
                  complianceFindings: [],
                  followUpRequests: [],
                  policyAssessment: { applicableRules: [], evaluations: [] },
                  recommendation: {
                    decision: "INSUFFICIENT_INFORMATION",
                    confidence: 0.5,
                    conditions: [],
                    policyExceptions: [],
                    rationale: [],
                  },
                  memo: { markdown: "Test memo", claims: [] },
                  confidence: { overall: 0.5, byComponent: {} },
                },
        });
      } else {
        runs.set(agentRunId, {
          status: "accepted",
          idempotencyKey: request.idempotencyKey,
        });
        // Simulate async processing
        setTimeout(() => {
          const run = runs.get(agentRunId);
          if (run) {
            if (behavior === "fail") {
              run.status = "failed";
              run.error = {
                schemaVersion: "1.0",
                code: "AGENT_CRASHED",
                message: "Simulated failure",
                requestId: "req-1",
              };
            }
            // "running" behavior stays in accepted/running
          }
        }, 50);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          schemaVersion: "1.0",
          agentRunId,
          status: "accepted",
        }),
      );
      return;
    }

    if (url.pathname.startsWith("/v1/runs/") && req.method === "GET") {
      const agentRunId = url.pathname.split("/")[3] ?? "";
      const run = runs.get(agentRunId);
      if (!run) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            schemaVersion: "1.0",
            code: "RUN_NOT_FOUND",
            message: "Not found",
            requestId: "req-1",
          }),
        );
        return;
      }

      const response: Record<string, unknown> = {
        schemaVersion: "1.0",
        agentRunId,
        status: run.status,
      };
      if (run.status === "completed") response["result"] = run.submission;
      if (run.status === "failed") response["error"] = run.error;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    if (url.pathname.startsWith("/v1/runs/") && req.method === "DELETE") {
      mockDeleteCount += 1;
      const agentRunId = url.pathname.split("/")[3] ?? "";
      const run = runs.get(agentRunId);
      if (!run) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            schemaVersion: "1.0",
            code: "RUN_NOT_FOUND",
            message: "Not found",
            requestId: "req-1",
          }),
        );
        return;
      }
      if (["completed", "failed", "cancelled"].includes(run.status)) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            schemaVersion: "1.0",
            code: "INVALID_RUN_STATE",
            message: "Already terminal",
            requestId: "req-1",
          }),
        );
        return;
      }
      run.status = "cancelled";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ schemaVersion: "1.0", agentRunId, cancelled: true }),
      );
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  mockAgentServer = () => {
    server.close();
  };

  return mockAgentUrl;
}

async function stopMockAgent(): Promise<void> {
  if (mockAgentServer) {
    mockAgentServer();
    mockAgentServer = null;
  }
}

describe("Budget enforcement", () => {
  it("should create initial budget state", () => {
    const state = createInitialBudgetState();
    expect(state).toEqual({
      wallClockSecondsUsed: 0,
      toolCallsUsed: 0,
      outputBytesUsed: 0,
      concurrentToolCalls: 0,
    });
  });

  it("should detect wall clock violation", () => {
    const budget: Budget = {
      wallClockSeconds: 10,
      maxToolCalls: 100,
      maxOutputBytes: 1000,
      maxConcurrentToolCalls: 4,
    };
    const state = { ...createInitialBudgetState(), wallClockSecondsUsed: 15 };
    const violation = checkBudgetViolation(budget, state);
    expect(violation).not.toBeNull();
    expect(violation!.type).toBe("wallClockSeconds");
  });

  it("should detect tool calls violation", () => {
    const budget: Budget = {
      wallClockSeconds: 900,
      maxToolCalls: 10,
      maxOutputBytes: 1000,
      maxConcurrentToolCalls: 4,
    };
    const state = { ...createInitialBudgetState(), toolCallsUsed: 15 };
    const violation = checkBudgetViolation(budget, state);
    expect(violation).not.toBeNull();
    expect(violation!.type).toBe("maxToolCalls");
  });

  it("should detect output bytes violation", () => {
    const budget: Budget = {
      wallClockSeconds: 900,
      maxToolCalls: 100,
      maxOutputBytes: 1000,
      maxConcurrentToolCalls: 4,
    };
    const state = { ...createInitialBudgetState(), outputBytesUsed: 2000 };
    const violation = checkBudgetViolation(budget, state);
    expect(violation).not.toBeNull();
    expect(violation!.type).toBe("maxOutputBytes");
  });

  it("should detect concurrent tool calls violation", () => {
    const budget: Budget = {
      wallClockSeconds: 900,
      maxToolCalls: 100,
      maxOutputBytes: 1000,
      maxConcurrentToolCalls: 2,
    };
    const state = { ...createInitialBudgetState(), concurrentToolCalls: 5 };
    const violation = checkBudgetViolation(budget, state);
    expect(violation).not.toBeNull();
    expect(violation!.type).toBe("maxConcurrentToolCalls");
  });

  it("should return null when no violation", () => {
    const budget: Budget = {
      wallClockSeconds: 900,
      maxToolCalls: 100,
      maxOutputBytes: 1000,
      maxConcurrentToolCalls: 4,
    };
    const state = createInitialBudgetState();
    const violation = checkBudgetViolation(budget, state);
    expect(violation).toBeNull();
  });

  it("should throw on enforceBudget with violation", () => {
    const budget: Budget = {
      wallClockSeconds: 10,
      maxToolCalls: 100,
      maxOutputBytes: 1000,
      maxConcurrentToolCalls: 4,
    };
    const state = { ...createInitialBudgetState(), wallClockSecondsUsed: 15 };
    expect(() => enforceBudget(budget, state)).toThrow(
      "Wall-clock time limit exceeded",
    );
  });
});

describe("LocalRunner", () => {
  let testCaseDir: string;
  let agentUrl = "";
  const testTimeout = 30000;

  beforeEach(async () => {
    testCaseDir = createTempCase();
    agentUrl = await startMockAgent("complete");
  });

  afterEach(async () => {
    await stopMockAgent();
    cleanupTempDir(testCaseDir);
  });

  it(
    "should run a case successfully and produce result directory",
    async () => {
      const runner = new LocalRunner({
        outputBase: join(tmpdir(), "uwbench-runs-test"),
      });
      const result = await runner.run({
        casePath: testCaseDir,
        agentUrl,
        skipHealthCheck: false,
      });

      expect(result.runId).toMatch(/^run_\d+_[a-f0-9]{8}$/);
      expect(existsSync(result.runDir)).toBe(true);
      expect(existsSync(result.eventsPath)).toBe(true);
      expect(existsSync(result.manifestPath)).toBe(true);
      expect(existsSync(result.submissionPath)).toBe(true);
      expect(existsSync(result.checksumsPath)).toBe(true);
      expect(existsSync(result.scorePath)).toBe(true);
      expect(result.status).toBe("completed");
    },
    testTimeout,
  );

  it(
    "should write valid events.ndjson with hash chain",
    async () => {
      const runner = new LocalRunner({
        outputBase: join(tmpdir(), "uwbench-runs-test"),
      });
      const result = await runner.run({
        casePath: testCaseDir,
        agentUrl,
        skipHealthCheck: false,
      });

      const eventsContent = readFileSync(result.eventsPath, "utf8");
      const events = eventsContent
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.length).toBeGreaterThan(0);

      // Verify hash chain
      const valid = await import("@uwbench/protocol").then((m) =>
        m.verifyChain(events),
      );
      expect(valid).toBe(true);

      // Check event types
      const types = events.map((e: any) => e.type);
      expect(types).toContain("RUN_STARTED");
      expect(types).toContain("AGENT_READY");
      expect(types).toContain("AGENT_RUN_STARTED");
      expect(types).toContain("AGENT_COMPLETED");
      expect(types).toContain("RUN_COMPLETED");
      expect(eventsContent).not.toMatch(/run-token-|bearerToken/);
    },
    testTimeout,
  );

  it(
    "should write valid run-manifest.json",
    async () => {
      const runner = new LocalRunner({
        outputBase: join(tmpdir(), "uwbench-runs-test"),
      });
      const result = await runner.run({
        casePath: testCaseDir,
        agentUrl,
        skipHealthCheck: false,
      });

      const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
      expect(manifest.schemaVersion).toBe("1.0");
      expect(manifest.runId).toBe(result.runId);
      expect(manifest.caseId).toBe("case-00001");
      expect(manifest.agentUrl).toBe(agentUrl);
      expect(manifest.status).toBe("completed");
      expect(manifest.limits).toEqual({
        wallClockSeconds: 900,
        maxToolCalls: 100,
        maxOutputBytes: 5_000_000,
        maxConcurrentToolCalls: 4,
      });
      expect(manifest.eventCount).toBeGreaterThan(0);
      expect(manifest.scoreStatus).toBe("not_scored");
    },
    testTimeout,
  );

  it(
    "should write valid submission.json",
    async () => {
      const runner = new LocalRunner({
        outputBase: join(tmpdir(), "uwbench-runs-test"),
      });
      const result = await runner.run({
        casePath: testCaseDir,
        agentUrl,
        skipHealthCheck: false,
      });

      const submission = JSON.parse(
        readFileSync(result.submissionPath, "utf8"),
      );
      expect(submission.schemaVersion).toBe("1.0");
      expect(submission.financialSpread).toBeDefined();
      expect(submission.recommendation).toBeDefined();
      expect(submission.recommendation.decision).toBe(
        "INSUFFICIENT_INFORMATION",
      );
    },
    testTimeout,
  );

  it(
    "should write valid checksums.json",
    async () => {
      const runner = new LocalRunner({
        outputBase: join(tmpdir(), "uwbench-runs-test"),
      });
      const result = await runner.run({
        casePath: testCaseDir,
        agentUrl,
        skipHealthCheck: false,
      });

      const checksums = JSON.parse(readFileSync(result.checksumsPath, "utf8"));
      expect(checksums.schemaVersion).toBe("1.0");
      expect(checksums.runId).toBe(result.runId);
      expect(checksums.files["events.ndjson"]).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(checksums.files["run-manifest.json"]).toMatch(
        /^sha256:[a-f0-9]{64}$/,
      );
      expect(checksums.files["submission.json"]).toMatch(
        /^sha256:[a-f0-9]{64}$/,
      );
      expect(checksums.files["score.json"]).toMatch(/^sha256:[a-f0-9]{64}$/);
    },
    testTimeout,
  );

  it(
    "should be idempotent for an ordinary duplicate configuration",
    async () => {
      const outputBase = join(
        tmpdir(),
        `uwbench-runs-idempotent-${randomUUID()}`,
      );
      const runner1 = new LocalRunner({ outputBase });
      const result1 = await runner1.run({
        casePath: testCaseDir,
        agentUrl,
        skipHealthCheck: false,
      });

      const runner2 = new LocalRunner({ outputBase });
      const result2 = await runner2.run({
        casePath: testCaseDir,
        agentUrl: `${agentUrl}/`,
        skipHealthCheck: false,
      });

      // Second run should return the same runId (idempotent)
      expect(result2.runId).toBe(result1.runId);
      expect(result2.runDir).toBe(result1.runDir);
    },
    testTimeout,
  );

  it("stages only the authoritative reasoning-only lane projection", () => {
    const validation = validateCaseSync(testCaseDir);
    expect(validation.case).toBeDefined();
    const view = createParticipantView(
      testCaseDir,
      "reasoning_only",
      validation.case!,
    );
    try {
      expect(existsSync(join(view, "normalized", "canonical-input.json"))).toBe(
        true,
      );
      expect(existsSync(join(view, "inputs"))).toBe(false);
      expect(existsSync(join(view, "private"))).toBe(false);
      const fixtures = JSON.parse(
        readFileSync(join(view, "environment", "tool-fixtures.json"), "utf8"),
      );
      expect(fixtures.records).toHaveLength(1);
      expect(fixtures.records[0].recordId).toBe("record_canonical_input");
      expect(JSON.stringify(fixtures)).not.toContain("record_financials_2024");
    } finally {
      cleanupTempDir(view);
    }
  });

  it("should handle agent failure", async () => {
    await stopMockAgent();
    agentUrl = await startMockAgent("fail");

    const runner = new LocalRunner({
      outputBase: join(tmpdir(), "uwbench-runs-test"),
    });
    const result = await runner.run({
      casePath: testCaseDir,
      agentUrl,
      skipHealthCheck: false,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("AGENT_CRASHED");

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.status).toBe("failed");
  });

  it("rejects a schema-invalid completed submission", async () => {
    await stopMockAgent();
    agentUrl = await startMockAgent("invalid");
    const runner = new LocalRunner({
      outputBase: join(tmpdir(), `uwbench-invalid-${randomUUID()}`),
    });
    const result = await runner.run({
      casePath: testCaseDir,
      agentUrl,
    });
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("status response invalid");
    expect(existsSync(result.submissionPath)).toBe(false);
  });

  it("enforces the final output-byte budget", async () => {
    const runner = new LocalRunner({
      outputBase: join(tmpdir(), `uwbench-output-budget-${randomUUID()}`),
    });
    const result = await runner.run({
      casePath: testCaseDir,
      agentUrl,
      limits: { maxOutputBytes: 100 },
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BUDGET_EXCEEDED");
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8")).status).toBe(
      "failed",
    );
  });

  it("rejects a lane not declared by the validated case", async () => {
    const runner = new LocalRunner();
    await expect(
      runner.run({
        casePath: testCaseDir,
        agentUrl,
        lane: "raw_documents",
      }),
    ).rejects.toThrow("is not supported");
  });

  it("should enforce wall clock budget", async () => {
    await stopMockAgent();
    agentUrl = await startMockAgent("running"); // Never completes

    const runner = new LocalRunner({
      outputBase: join(tmpdir(), "uwbench-runs-test"),
    });
    const result = await runner.run({
      casePath: testCaseDir,
      agentUrl,
      limits: { wallClockSeconds: 1 }, // Very short timeout
      skipHealthCheck: false,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BUDGET_EXCEEDED");

    const eventsContent = readFileSync(result.eventsPath, "utf8");
    const events = eventsContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const limitWarnings = events.filter((e: any) => e.type === "LIMIT_WARNING");
    expect(limitWarnings.length).toBeGreaterThan(0);
    expect(limitWarnings[0].payload.violationType).toBe("wallClockSeconds");
  });

  it("should handle cancellation via SIGTERM", async () => {
    await stopMockAgent();
    agentUrl = await startMockAgent("running"); // Never completes

    const runner = new LocalRunner({
      outputBase: join(tmpdir(), "uwbench-runs-test"),
    });
    const runPromise = runner.run({
      casePath: testCaseDir,
      agentUrl,
      skipHealthCheck: false,
    });

    // Wait until the remote run exists so cancellation must clean it up.
    const sigtermListenersBefore = process.listenerCount("SIGTERM");
    for (
      let attempts = 0;
      mockStartedRunCount === 0 && attempts < 100;
      attempts++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mockStartedRunCount).toBe(1);

    // Simulate SIGTERM
    process.emit("SIGTERM");

    const result = await runPromise;
    expect(result.status).toBe("cancelled");
    expect(mockDeleteCount).toBe(1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListenersBefore - 1);

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.status).toBe("cancelled");

    const eventsContent = readFileSync(result.eventsPath, "utf8");
    const events = eventsContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const cancelledEvents = events.filter(
      (e: any) => e.type === "RUN_CANCELLED",
    );
    expect(cancelledEvents.length).toBe(1);
  });
});

describe("verifyRun", () => {
  let testCaseDir: string;
  let agentUrl = "";

  beforeEach(async () => {
    testCaseDir = createTempCase();
    agentUrl = await startMockAgent("complete");
  });

  afterEach(async () => {
    await stopMockAgent();
    cleanupTempDir(testCaseDir);
  });

  it("should verify a valid run directory", async () => {
    const runner = new LocalRunner({
      outputBase: join(tmpdir(), "uwbench-runs-test"),
    });
    const result = await runner.run({
      casePath: testCaseDir,
      agentUrl,
      skipHealthCheck: false,
    });

    const verification = await verifyRun(result.runDir);
    expect(verification.valid).toBe(true);
    expect(verification.eventsValid).toBe(true);
    expect(verification.checksumsValid).toBe(true);
    expect(verification.errors).toHaveLength(0);
    expect(verification.manifest).toBeDefined();
  });

  it("should detect missing files", async () => {
    const emptyDir = join(tmpdir(), `uwbench-verify-${randomUUID()}`);
    mkdirSync(emptyDir, { recursive: true });

    const verification = await verifyRun(emptyDir);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain("Missing run-manifest.json");
    expect(verification.errors).toContain("Missing events.ndjson");
    expect(verification.errors).toContain("Missing checksums.json");

    cleanupTempDir(emptyDir);
  });

  it("rejects a hash-valid event stream containing schema-invalid fields", async () => {
    const runner = new LocalRunner({
      outputBase: join(tmpdir(), `uwbench-verify-schema-${randomUUID()}`),
    });
    const result = await runner.run({ casePath: testCaseDir, agentUrl });
    const events = readFileSync(result.eventsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    events[0].unexpected = true;
    for (let index = 0; index < events.length; index += 1) {
      events[index].previousHash =
        index === 0 ? "sha256:genesis" : events[index - 1].hash;
      const { hash: _hash, ...withoutHash } = events[index];
      events[index].hash = computeHash(withoutHash as EventWithoutHash);
    }
    writeFileSync(
      result.eventsPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    refreshChecksum(result.runDir, "events.ndjson");
    const verification = await verifyRun(result.runDir);
    expect(verification.valid).toBe(false);
    expect(verification.errors.join(" ")).toContain("schema validation failed");
  });

  it("rejects cross-artifact event counts even with refreshed checksums", async () => {
    const runner = new LocalRunner({
      outputBase: join(tmpdir(), `uwbench-verify-count-${randomUUID()}`),
    });
    const result = await runner.run({ casePath: testCaseDir, agentUrl });
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    manifest.eventCount += 1;
    writeFileSync(result.manifestPath, JSON.stringify(manifest, null, 2));
    refreshChecksum(result.runDir, "run-manifest.json");
    const verification = await verifyRun(result.runDir);
    expect(verification.valid).toBe(false);
    expect(verification.errors.join(" ")).toContain("eventCount");
  });

  it("rejects unsafe checksum paths without reading outside the run", async () => {
    const runner = new LocalRunner({
      outputBase: join(tmpdir(), `uwbench-verify-path-${randomUUID()}`),
    });
    const result = await runner.run({ casePath: testCaseDir, agentUrl });
    const checksums = JSON.parse(readFileSync(result.checksumsPath, "utf8"));
    checksums.files["../outside.json"] = `sha256:${"0".repeat(64)}`;
    writeFileSync(result.checksumsPath, JSON.stringify(checksums, null, 2));
    const verification = await verifyRun(result.runDir);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "Unsafe checksum path: ../outside.json",
    );
  });
});
