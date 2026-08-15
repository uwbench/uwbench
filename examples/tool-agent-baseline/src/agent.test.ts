import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RunStatusResponseSchema } from "@uwbench/protocol";
import { ToolGateway } from "@uwbench/tool-runtime";
import { RealToolAgent } from "./real-agent.js";

const TOKEN = "tool-agent-protocol";
const runningAgents: RealToolAgent[] = [];
const runningGateways: ToolGateway[] = [];

afterEach(async () => {
  await Promise.all(runningAgents.splice(0).map((agent) => agent.stop()));
  await Promise.all(runningGateways.splice(0).map((gateway) => gateway.stop()));
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("tool agent protocol", () => {
  it("completes a protocol run using only the run-scoped gateway", async () => {
    const gateway = new ToolGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 80,
    });
    runningGateways.push(gateway);
    await gateway.start();
    const port = await freePort();
    const agent = new RealToolAgent({ port });
    runningAgents.push(agent);
    await agent.start();

    const request = {
      schemaVersion: "1.0",
      idempotencyKey: "tool-agent-same-run",
      benchmark: "commercial-credit",
      benchmarkVersion: "0.1.0",
      lane: "normalized_data",
      caseId: "opaque-case",
      objective: "Underwrite using advertised tools and request tax_returns.",
      requiredOutputs: ["recommendation"],
      toolGateway: {
        url: `http://127.0.0.1:${gateway.port}/v1/tools/call`,
        bearerToken: TOKEN,
      },
      limits: {
        wallClockSeconds: 30,
        maxToolCalls: 80,
        maxOutputBytes: 1_000_000,
        maxConcurrentToolCalls: 1,
      },
    };
    const start = await fetch(`http://127.0.0.1:${port}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const accepted = (await start.json()) as { agentRunId: string };
    let status: unknown;
    for (let index = 0; index < 40; index += 1) {
      status = await (
        await fetch(`http://127.0.0.1:${port}/v1/runs/${accepted.agentRunId}`)
      ).json();
      if ((status as { status?: string }).status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const parsed = RunStatusResponseSchema.parse(status);
    expect(parsed.status).toBe("completed");
    if (parsed.status === "completed") {
      expect(parsed.result.memo.markdown).toContain("tool-agent-baseline-v1");
      expect(JSON.stringify(parsed.result)).not.toContain(TOKEN);
    }

    const replay = await fetch(`http://127.0.0.1:${port}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const replayed = (await replay.json()) as { agentRunId: string };
    expect(replayed.agentRunId).toBe(accepted.agentRunId);
  });
});
