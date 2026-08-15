import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FinancialSpreadSchema,
  type FinancialSpread,
  type ToolName,
} from "@uwbench/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { ToolClient, ToolClientError } from "../client.js";
import { ToolGateway } from "../gateway.js";

const TOKEN = "client-run-token";
const PUBLIC_CASE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../benchmark/commercial-credit-v0.1/public-cases/case-00001",
);

const spread: FinancialSpread = FinancialSpreadSchema.parse({
  revenue: { amount: 5_000_000, currency: "USD" },
  ebitda: { amount: 2_000_000, currency: "USD" },
  debtService: { amount: 1_000_000, currency: "USD" },
  period: { start: "2025-01-01", end: "2025-12-31" },
  currency: "USD",
  scale: "units",
  signConvention: "all_positive",
});

const running: ToolGateway[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((gateway) => gateway.stop()));
});

async function startGateway(
  options: ConstructorParameters<typeof ToolGateway>[0],
): Promise<{ gateway: ToolGateway; url: string }> {
  const gateway = new ToolGateway(options);
  running.push(gateway);
  await gateway.start();
  return { gateway, url: `http://127.0.0.1:${gateway.port}/v1/tools/call` };
}

describe("ToolClient", () => {
  it("uses only advertised tools and a run-scoped bearer token", async () => {
    const { url } = await startGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 10,
    });
    const client = new ToolClient({
      url,
      bearerToken: TOKEN,
      advertisedTools: ["case.list_documents"],
    });

    const listed = await client.call("case.list_documents", {});
    expect(listed["documents"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentId: "doc_001" }),
      ]),
    );

    await expect(
      client.call("case.read_document" as ToolName, { documentId: "doc_001" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_TOOL" });
    expect(
      client.calls.some((call) => call.name === "case.read_document"),
    ).toBe(false);

    const denied = new ToolClient({
      url,
      bearerToken: "wrong-token",
      advertisedTools: ["case.list_documents"],
    });
    await expect(denied.call("case.list_documents", {})).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
  });

  it("retries a transient gateway failure with the same callId", async () => {
    let attempts = 0;
    const { url } = await startGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 5,
    });
    const client = new ToolClient({
      url,
      bearerToken: TOKEN,
      maxRetries: 2,
      retryDelayMs: 0,
      fetchImpl: async (input, init) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("socket hang up");
        }
        return fetch(input, init);
      },
    });

    const result = await client.call(
      "case.list_documents",
      {},
      { callId: "retry-same-id" },
    );
    expect(attempts).toBe(2);
    expect(result["documents"]).toBeDefined();
    expect(
      client.calls.filter((call) => call.callId === "retry-same-id"),
    ).toHaveLength(2);
    expect(client.calls.map((call) => call.callId)).toEqual([
      "retry-same-id",
      "retry-same-id",
    ]);
  });

  it("returns a cached result for a duplicate callId without a second execution", async () => {
    const { gateway, url } = await startGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 1,
    });
    const client = new ToolClient({ url, bearerToken: TOKEN, maxToolCalls: 1 });
    const first = await client.call(
      "case.list_documents",
      {},
      { callId: "dup-1" },
    );
    const second = await client.call(
      "case.list_documents",
      {},
      { callId: "dup-1" },
    );
    expect(second).toEqual(first);
    expect(client.calls.filter((call) => call.cached)).toHaveLength(1);
    expect(gateway.getRunUsage(TOKEN)).toMatchObject({
      toolCallCount: 1,
      attemptedToolCallCount: 1,
    });
  });

  it("fails closed when the local or gateway budget is exhausted", async () => {
    const { url } = await startGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 1,
    });
    const client = new ToolClient({ url, bearerToken: TOKEN, maxToolCalls: 1 });
    await client.call("case.list_documents", {}, { callId: "budget-1" });
    await expect(
      client.call(
        "policy.search",
        { query: "minimum" },
        { callId: "budget-2" },
      ),
    ).rejects.toBeInstanceOf(ToolClientError);
    await expect(
      client.call(
        "policy.search",
        { query: "minimum" },
        { callId: "budget-2" },
      ),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("surfaces permanent tool failures without retrying", async () => {
    let attempts = 0;
    const { url } = await startGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 5,
    });
    const client = new ToolClient({
      url,
      bearerToken: TOKEN,
      maxRetries: 3,
      retryDelayMs: 0,
      fetchImpl: async (input, init) => {
        attempts += 1;
        return fetch(input, init);
      },
    });
    const missing = await client.tryCall("case.read_document", {
      documentId: "does-not-exist",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("NOT_FOUND");
    expect(attempts).toBe(1);
  });

  it("runs against a frozen public case without reading private references", async () => {
    expect(PUBLIC_CASE.includes(`${"private"}/`)).toBe(false);
    const { url } = await startGateway({
      port: 0,
      casePath: PUBLIC_CASE,
      runToken: TOKEN,
      maxToolCalls: 20,
    });
    const client = new ToolClient({ url, bearerToken: TOKEN });

    const documents = (await client.call("case.list_documents", {})) as {
      documents: { documentId: string }[];
    };
    expect(documents.documents).toEqual([]);

    const requested = await client.call("case.request_information", {
      requested_concepts: ["tax_returns"],
      question: "Provide available tax_returns information.",
    });
    expect(requested["status"]).toBe("AVAILABLE");
    const revealed = requested["revealedDocumentIds"] as string[];
    expect(revealed).toContain("doc_tax_returns_2022_2024");

    const read = await client.call("case.read_document", {
      documentId: revealed[0],
    });
    expect(String(read["content"])).toContain("Tax return summary");
    expect(JSON.stringify(read)).not.toContain("private/");
    expect(JSON.stringify(read)).not.toContain("expected-spread");

    const financials = await client.call("case.get_structured_record", {
      recordId: "record_financials_2024",
    });
    const record = financials["record"] as Record<string, number>;
    const ratios = await client.call("finance.calculate_ratios", {
      spread: {
        revenue: { amount: record["revenue"], currency: "USD" },
        ebitda: { amount: record["ebitda"], currency: "USD" },
        debtService: { amount: record["debt_service"], currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD",
        scale: "units",
        signConvention: "all_positive",
      },
    });
    expect((ratios["ratios"] as Record<string, number>)["dscr"]).toBeCloseTo(
      104_000_000 / 38_000_000,
    );
    expect(client.usedTools()).toEqual(
      expect.arrayContaining([
        "case.list_documents",
        "case.request_information",
        "case.read_document",
        "case.get_structured_record",
        "finance.calculate_ratios",
      ]),
    );
  });

  it("loads only the participant-visible fixture file from a copied public case", async () => {
    const root = mkdtempSync(join(tmpdir(), "uwbench-public-case-"));
    try {
      mkdirSync(join(root, "environment"), { recursive: true });
      writeFileSync(
        join(root, "environment", "tool-fixtures.json"),
        JSON.stringify({
          documents: [],
          revealableDocuments: [],
          records: [
            {
              recordId: "record_financials_2024",
              sourceId: "src_financials_2024",
              record: { revenue: 1, ebitda: 1 },
            },
          ],
          policies: [],
          information: {},
        }),
      );
      const { url } = await startGateway({
        port: 0,
        casePath: root,
        runToken: TOKEN,
        maxToolCalls: 5,
      });
      const client = new ToolClient({ url, bearerToken: TOKEN });
      const record = await client.call("case.get_structured_record", {
        recordId: "record_financials_2024",
      });
      expect(record["sourceId"]).toBe("src_financials_2024");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("can validate a discovered spread through the finance tools", async () => {
    const { url } = await startGateway({
      port: 0,
      runToken: TOKEN,
      maxToolCalls: 5,
    });
    const client = new ToolClient({ url, bearerToken: TOKEN });
    const validated = await client.call("finance.validate_spread", { spread });
    expect(validated["valid"]).toBe(true);
    const calculated = await client.call("finance.calculate", {
      expression: "ebitda / debtService",
      variables: { ebitda: 2_000_000, debtService: 1_000_000 },
    });
    expect(calculated["result"]).toBe(2);
  });
});
