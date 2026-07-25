import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FakeAgent } from "../src/fake-agent.js";
import {
  runConformanceTests,
  runFakeAgentConformanceTests,
  type ConformanceTestConfig,
} from "../src/conformance.js";

describe("Protocol Conformance Tests", () => {
  let fakeAgent: FakeAgent;
  const baseUrl = "http://localhost:19090";
  const config: ConformanceTestConfig = { baseUrl, timeoutMs: 10000 };

  beforeAll(async () => {
    fakeAgent = new FakeAgent({ baseUrl, behavior: "complete" });
    await fakeAgent.start();
    // Wait for server to be ready
    await new Promise((r) => setTimeout(r, 500));
  }, 15000);

  afterAll(async () => {
    await fakeAgent.stop();
  }, 10000);

  it("passes remote-agent and controllable fixture conformance", async () => {
    const remoteResult = await runConformanceTests(config);
    const fixtureResult = await runFakeAgentConformanceTests(config);

    // Print results for visibility
    console.log("\n=== Conformance Test Results ===");
    for (const test of [...remoteResult.results, ...fixtureResult.results]) {
      const status = test.passed ? "✓" : "✗";
      console.log(`${status} ${test.name}: ${test.message}`);
      if (!test.passed && test.details) {
        console.log(`   Details:`, test.details);
      }
    }
    const passed = remoteResult.summary.passed + fixtureResult.summary.passed;
    const total = remoteResult.summary.total + fixtureResult.summary.total;
    console.log(`\nSummary: ${passed}/${total} passed\n`);

    expect(remoteResult.passed).toBe(true);
    expect(fixtureResult.passed).toBe(true);
    expect(remoteResult.summary.failed + fixtureResult.summary.failed).toBe(0);
  }, 60000);
});

describe("FakeAgent - Individual Behaviors", () => {
  let agent: FakeAgent;
  const baseUrl = "http://localhost:19091";

  beforeAll(async () => {
    agent = new FakeAgent({ baseUrl, behavior: "complete" });
    await agent.start();
    await new Promise((r) => setTimeout(r, 500));
  }, 15000);

  afterAll(async () => {
    await agent.stop();
  }, 10000);

  it("should start and stop correctly", async () => {
    const testAgent = new FakeAgent({
      baseUrl: "http://localhost:19092",
      behavior: "complete",
    });
    await testAgent.start();
    await testAgent.stop();
    expect(true).toBe(true);
  });

  it("should handle health endpoint", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.schemaVersion).toBe("1.0");
    expect(body.version).toBeDefined();
  });

  it("should accept valid run request", async () => {
    const runRequest = {
      schemaVersion: "1.0",
      benchmark: "commercial-credit",
      benchmarkVersion: "0.1.0",
      lane: "reasoning_only",
      caseId: "test-case-001",
      objective: "Test underwriting",
      requiredOutputs: [
        "financial_spread",
        "risks",
        "follow_up_requests",
        "policy_assessment",
        "recommendation",
        "credit_memo",
      ],
      toolGateway: {
        url: "http://localhost:8080/v1/tools/call",
        bearerToken: "test-token",
      },
      limits: {
        wallClockSeconds: 900,
        maxToolCalls: 100,
        maxOutputBytes: 5000000,
        maxConcurrentToolCalls: 4,
      },
    };

    const res = await fetch(`${baseUrl}/v1/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runRequest),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.agentRunId).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("should reject unknown schema version", async () => {
    const runRequest = {
      schemaVersion: "9.9",
      benchmark: "commercial-credit",
      benchmarkVersion: "0.1.0",
      lane: "reasoning_only",
      caseId: "test-case-001",
      objective: "Test underwriting",
      requiredOutputs: [],
      toolGateway: {
        url: "http://localhost:8080/v1/tools/call",
        bearerToken: "test-token",
      },
      limits: {
        wallClockSeconds: 900,
        maxToolCalls: 100,
        maxOutputBytes: 5000000,
        maxConcurrentToolCalls: 4,
      },
    };

    const res = await fetch(`${baseUrl}/v1/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runRequest),
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("should handle idempotency key", async () => {
    const runRequest = {
      schemaVersion: "1.0",
      benchmark: "commercial-credit",
      benchmarkVersion: "0.1.0",
      lane: "reasoning_only",
      caseId: "test-case-002",
      objective: "Test idempotency",
      requiredOutputs: [],
      toolGateway: {
        url: "http://localhost:8080/v1/tools/call",
        bearerToken: "test-token",
      },
      limits: {
        wallClockSeconds: 900,
        maxToolCalls: 100,
        maxOutputBytes: 5000000,
        maxConcurrentToolCalls: 4,
      },
      idempotencyKey: "idem-test-123",
    };

    const res1 = await fetch(`${baseUrl}/v1/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runRequest),
    });
    expect(res1.ok).toBe(true);
    const body1 = await res1.json();

    const res2 = await fetch(`${baseUrl}/v1/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runRequest),
    });
    expect(res2.ok).toBe(true);
    const body2 = await res2.json();

    expect(body1.agentRunId).toBe(body2.agentRunId);
  });
});
