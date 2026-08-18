import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RunStatusResponseSchema } from "@uwbench/protocol";
import { ToolGateway } from "@uwbench/tool-runtime";
import { SecureLendAdapter } from "./adapter.js";
import {
  ADAPTER_NAME,
  ADAPTER_VERSION,
  HARNESS_ID,
  type AdapterConfig,
} from "./identity.js";
import {
  documentFixture,
  guardedFetch,
  MockSecureLendMcp,
} from "./__tests__/mock-mcp.js";

const TOKEN = "uwbench-mcp-test-token";
const running: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((item) => item.stop()));
});

function participant(): AdapterConfig["participant"] {
  return {
    harness: HARNESS_ID,
    harnessVersion: "undeclared",
    model: "claude-sonnet-4-6",
    modelVersion: "undeclared",
    provider: "undeclared",
    providerVersion: "undeclared",
    adapter: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
  };
}

function runRequest(gatewayUrl: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    idempotencyKey: "securelend-mcp-same-run",
    benchmark: "raw-documents",
    benchmarkVersion: "0.1.0",
    lane: "raw_documents",
    caseId: "case-raw-aapl",
    objective: "Underwrite the credit file.",
    requiredOutputs: ["recommendation"],
    toolGateway: {
      url: gatewayUrl,
      bearerToken: TOKEN,
    },
    limits: {
      wallClockSeconds: 30,
      maxToolCalls: 40,
      maxOutputBytes: 1_000_000,
      maxConcurrentToolCalls: 1,
    },
  };
}

async function pollCompleted(
  baseUrl: string,
  agentRunId: string,
): Promise<unknown> {
  let status: unknown;
  for (let index = 0; index < 80; index += 1) {
    status = await (await fetch(`${baseUrl}/v1/runs/${agentRunId}`)).json();
    const current = status as { status?: string };
    if (
      current.status === "completed" ||
      current.status === "failed" ||
      current.status === "cancelled"
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return status;
}

describe("protocol-proxy mode", () => {
  it("serves UWBench health locally and forwards /v1/runs", async () => {
    const proxied: string[] = [];
    const upstream = createServer((request, response) => {
      proxied.push(`${request.method ?? "GET"} ${request.url ?? "/"}`);
      response.writeHead(202, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          schemaVersion: "1.0",
          agentRunId: "upstream_run_1",
          status: "accepted",
        }),
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    running.push({
      stop: () =>
        new Promise((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    });
    const address = upstream.address();
    const upstreamPort =
      typeof address === "object" && address ? address.port : 0;
    const adapter = new SecureLendAdapter({
      port: 0,
      config: {
        mode: "protocol",
        participant: participant(),
        protocolUpstream: `http://127.0.0.1:${upstreamPort}`,
      },
    });
    running.push(adapter);
    await adapter.start();
    const base = `http://127.0.0.1:${adapter.portNumber}`;

    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({
      schemaVersion: "1.0",
      status: "ok",
      participant: { model: "claude-sonnet-4-6", adapter: ADAPTER_NAME },
    });
    expect(proxied).toEqual([]);

    const started = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runRequest("http://127.0.0.1:1/v1/tools/call")),
    });
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({
      agentRunId: "upstream_run_1",
      status: "accepted",
    });
    expect(proxied).toEqual(["POST /v1/runs"]);
  });
});

describe("MCP product chat-path mode", () => {
  it("translates a UWBench run into the frontend MCP sequence and uploads files", async () => {
    const mcp = new MockSecureLendMcp({ uploadStyle: "put" });
    running.push(mcp);
    await mcp.start();
    const gateway = new ToolGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 40,
      fixtures: {
        documents: [documentFixture({ fileName: "statement.txt" })],
        records: [],
      },
    });
    running.push(gateway);
    await gateway.start();

    const adapter = new SecureLendAdapter({
      port: 0,
      config: {
        mode: "mcp",
        participant: participant(),
        mcp: {
          url: mcp.mcpUrl,
          token: "mcp-secret",
          pollIntervalMs: 10,
          pollTimeoutMs: 2_000,
        },
      },
      chatPath: {
        mcpUrl: mcp.mcpUrl,
        token: "mcp-secret",
        pollIntervalMs: 10,
        pollTimeoutMs: 2_000,
        fetchImpl: guardedFetch(),
        now: () => 1_700_000_000_000,
      },
    });
    running.push(adapter);
    await adapter.start();
    const base = `http://127.0.0.1:${adapter.portNumber}`;

    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({
      participant: { model: "claude-sonnet-4-6" },
    });

    const started = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        runRequest(`http://127.0.0.1:${gateway.port}/v1/tools/call`),
      ),
    });
    const accepted = (await started.json()) as { agentRunId: string };
    const status = RunStatusResponseSchema.parse(
      await pollCompleted(base, accepted.agentRunId),
    );
    expect(status.status).toBe("completed");
    if (status.status === "completed") {
      expect(status.result.recommendation.decision).toBe("REFER");
      expect(status.result.memo.markdown).toContain("tax returns");
    }

    const names = mcp.calls.map((call) => call.name);
    expect(names).toContain("create_deal_workspace");
    expect(names).toContain("submit_documents");
    expect(names).toContain("run_document_intelligence");
    expect(names).toContain("run_data_extraction");
    expect(names).toContain("run_financial_statement_spread");
    expect(names).toContain("run_professional_memo");
    expect(names).toContain("get_memo_status");
    expect(mcp.calls[0]?.arguments["clientName"]).toBe(
      "uwbench-case-raw-aapl-1700000000000",
    );
    expect(mcp.uploads.length).toBeGreaterThan(0);
    expect(mcp.finalizeBodies).toEqual([]);
    expect(JSON.stringify(mcp.calls)).not.toMatch(/jayjchow|rekord/i);
    expect(mcp.urls.every((url) => !url.includes("securelend.ai"))).toBe(true);
  });

  it("skips upload for already-extracted cases and feeds the case package", async () => {
    const mcp = new MockSecureLendMcp();
    running.push(mcp);
    await mcp.start();
    const gateway = new ToolGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 40,
      fixtures: {
        documents: [],
        records: [
          {
            recordId: "record_canonical_input",
            sourceId: "normalized:canonical-input",
            record: { legal_name: "Acme Manufacturing LLC" },
          },
        ],
      },
    });
    running.push(gateway);
    await gateway.start();

    const adapter = new SecureLendAdapter({
      port: 0,
      config: {
        mode: "mcp",
        participant: participant(),
        mcp: {
          url: mcp.mcpUrl,
          token: "mcp-secret",
          pollIntervalMs: 10,
          pollTimeoutMs: 2_000,
        },
      },
      chatPath: {
        mcpUrl: mcp.mcpUrl,
        token: "mcp-secret",
        pollIntervalMs: 10,
        pollTimeoutMs: 2_000,
        fetchImpl: guardedFetch(),
        now: () => 42,
      },
    });
    running.push(adapter);
    await adapter.start();
    const started = await fetch(
      `http://127.0.0.1:${adapter.portNumber}/v1/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...runRequest(`http://127.0.0.1:${gateway.port}/v1/tools/call`),
          lane: "normalized_data",
          caseId: "case-00001",
        }),
      },
    );
    const accepted = (await started.json()) as { agentRunId: string };
    const status = RunStatusResponseSchema.parse(
      await pollCompleted(
        `http://127.0.0.1:${adapter.portNumber}`,
        accepted.agentRunId,
      ),
    );
    expect(status.status).toBe("completed");
    expect(mcp.calls.map((call) => call.name)).not.toContain(
      "submit_documents",
    );
    expect(mcp.uploads).toEqual([]);
    const extraction = mcp.calls.find(
      (call) => call.name === "run_data_extraction",
    );
    expect(extraction?.arguments["blueprintType"]).toBe("financial_statement");
    expect(extraction?.arguments["casePackage"]).toMatchObject({
      caseId: "case-00001",
      records: [
        expect.objectContaining({ recordId: "record_canonical_input" }),
      ],
    });
  });

  it("finalizes uploads only when SECURELEND_DOCUMENT_API_URL is configured", async () => {
    const mcp = new MockSecureLendMcp({ uploadStyle: "post" });
    running.push(mcp);
    await mcp.start();
    const gateway = new ToolGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 40,
      fixtures: {
        documents: [documentFixture({ fileName: "statement.txt" })],
      },
    });
    running.push(gateway);
    await gateway.start();
    const adapter = new SecureLendAdapter({
      port: 0,
      config: {
        mode: "mcp",
        participant: participant(),
        mcp: {
          url: mcp.mcpUrl,
          token: "mcp-secret",
          documentApiUrl: mcp.documentApiUrl,
          pollIntervalMs: 10,
          pollTimeoutMs: 2_000,
        },
      },
      chatPath: {
        mcpUrl: mcp.mcpUrl,
        token: "mcp-secret",
        documentApiUrl: mcp.documentApiUrl,
        pollIntervalMs: 10,
        pollTimeoutMs: 2_000,
        fetchImpl: guardedFetch(),
        now: () => 99,
      },
    });
    running.push(adapter);
    await adapter.start();
    const started = await fetch(
      `http://127.0.0.1:${adapter.portNumber}/v1/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          runRequest(`http://127.0.0.1:${gateway.port}/v1/tools/call`),
        ),
      },
    );
    const accepted = (await started.json()) as { agentRunId: string };
    const status = await pollCompleted(
      `http://127.0.0.1:${adapter.portNumber}`,
      accepted.agentRunId,
    );
    expect((status as { status?: string }).status).toBe("completed");
    expect(mcp.uploads.length).toBeGreaterThan(0);
    expect(mcp.finalizeBodies).toEqual([
      expect.objectContaining({
        workspaceId: "ws_uwbench_ephemeral",
        documentId: "sl_doc_1",
      }),
    ]);
  });

  it("uses public catalog aliases when frontend run_* names are absent", async () => {
    const mcp = new MockSecureLendMcp({
      catalog: [
        "create_deal_workspace",
        "submit_documents",
        "document_intelligence_agent",
        "data_extraction_agent",
        "professional_memo_agent",
        "get_memo_status",
      ],
    });
    running.push(mcp);
    await mcp.start();
    const gateway = new ToolGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 40,
      fixtures: {
        documents: [documentFixture({ fileName: "statement.txt" })],
        records: [],
      },
    });
    running.push(gateway);
    await gateway.start();
    const adapter = new SecureLendAdapter({
      port: 0,
      config: {
        mode: "mcp",
        participant: participant(),
        mcp: {
          url: mcp.mcpUrl,
          token: "mcp-secret",
          pollIntervalMs: 10,
          pollTimeoutMs: 2_000,
        },
      },
      chatPath: {
        mcpUrl: mcp.mcpUrl,
        token: "mcp-secret",
        pollIntervalMs: 10,
        pollTimeoutMs: 2_000,
        fetchImpl: guardedFetch(),
        now: () => 7,
      },
    });
    running.push(adapter);
    await adapter.start();
    const started = await fetch(
      `http://127.0.0.1:${adapter.portNumber}/v1/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          runRequest(`http://127.0.0.1:${gateway.port}/v1/tools/call`),
        ),
      },
    );
    const accepted = (await started.json()) as { agentRunId: string };
    const status = await pollCompleted(
      `http://127.0.0.1:${adapter.portNumber}`,
      accepted.agentRunId,
    );
    expect((status as { status?: string }).status).toBe("completed");
    expect(mcp.calls.map((call) => call.name)).toEqual(
      expect.arrayContaining([
        "document_intelligence_agent",
        "data_extraction_agent",
        "professional_memo_agent",
      ]),
    );
    expect(mcp.calls.map((call) => call.name)).not.toContain(
      "run_document_intelligence",
    );
  });
});
