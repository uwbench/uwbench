import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export interface MockMcpCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MockMcpOptions {
  catalog?: string[];
  uploadStyle?: "put" | "post";
  memoDelayPolls?: number;
}

export class MockSecureLendMcp {
  readonly calls: MockMcpCall[] = [];
  readonly uploads: Buffer[] = [];
  readonly finalizeBodies: unknown[] = [];
  readonly urls: string[] = [];
  memoPolls = 0;
  private server: ReturnType<typeof createServer> | null = null;
  private readonly options: Required<
    Pick<MockMcpOptions, "uploadStyle" | "memoDelayPolls">
  > & { catalog: string[] };

  constructor(options: MockMcpOptions = {}) {
    this.options = {
      catalog: options.catalog ?? [
        "create_deal_workspace",
        "submit_documents",
        "run_document_intelligence",
        "run_data_extraction",
        "run_financial_statement_spread",
        "run_professional_memo",
        "get_memo_status",
      ],
      uploadStyle: options.uploadStyle ?? "put",
      memoDelayPolls: options.memoDelayPolls ?? 1,
    };
  }

  get port(): number {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : 0;
  }

  get mcpUrl(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  get uploadUrl(): string {
    return `http://127.0.0.1:${this.port}/upload`;
  }

  get documentApiUrl(): string {
    return `http://127.0.0.1:${this.port}/api/document/internal/process-uploaded-document`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(0, "127.0.0.1");
    });
    this.server = server;
  }

  private rejectsMissingDocumentId(
    name: string,
    args: Record<string, unknown>,
  ): boolean {
    if (
      name !== "run_data_extraction" &&
      name !== "data_extraction_agent" &&
      name !== "run_document_intelligence" &&
      name !== "document_intelligence_agent"
    ) {
      return false;
    }
    return typeof args["documentId"] !== "string" || args["documentId"] === "";
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.port}`);
    this.urls.push(`${request.method ?? "GET"} ${url.pathname}`);
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);

    if (url.pathname === "/upload") {
      this.uploads.push(raw);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/document/internal/process-uploaded-document") {
      this.finalizeBodies.push(JSON.parse(raw.toString("utf8") || "{}"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname !== "/mcp") {
      response.writeHead(404);
      response.end();
      return;
    }

    const body = JSON.parse(raw.toString("utf8") || "{}") as {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };
    const id = body.id ?? 1;
    if (body.method === "initialize") {
      this.sendJson(response, {
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: "2024-11-05", capabilities: {} },
      });
      return;
    }
    if (body.method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }
    if (body.method === "tools/list") {
      this.sendJson(response, {
        jsonrpc: "2.0",
        id,
        result: {
          tools: this.options.catalog.map((name) => ({ name })),
        },
      });
      return;
    }
    if (body.method !== "tools/call") {
      this.sendJson(response, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method ${body.method}` },
      });
      return;
    }

    const name = String(body.params?.["name"] ?? "");
    const args = (body.params?.["arguments"] as Record<string, unknown>) ?? {};
    this.calls.push({ name, arguments: args });
    if (this.rejectsMissingDocumentId(name, args)) {
      this.sendJson(response, {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: `Invalid arguments for tool ${name}: documentId expected string, got ${String(args["documentId"])}`,
        },
      });
      return;
    }
    this.sendJson(response, {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          { type: "text", text: JSON.stringify(this.toolResult(name, args)) },
        ],
      },
    });
  }

  private toolResult(
    name: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (name === "create_deal_workspace") {
      return {
        workspaceId: "ws_uwbench_ephemeral",
        clientName: args["clientName"],
        status: "ACTIVE",
      };
    }
    if (name === "submit_documents") {
      const fields =
        this.options.uploadStyle === "post"
          ? { key: "uwbench/doc-1", policy: "test", "x-amz-signature": "sig" }
          : undefined;
      return {
        documentId: "sl_doc_1",
        status: "PENDING_UPLOAD",
        uploadUrl: this.uploadUrl,
        ...(fields ? { uploadFields: fields, method: "POST" } : {}),
      };
    }
    if (
      name === "run_document_intelligence" ||
      name === "document_intelligence_agent"
    ) {
      return {
        documentId: args["documentId"],
        classification: "financial_statement",
      };
    }
    if (name === "run_data_extraction" || name === "data_extraction_agent") {
      return {
        blueprintType: args["blueprintType"],
        casePackage: args["casePackage"],
        financialSpread: {
          revenue: { amount: 5_000_000, currency: "USD" },
          ebitda: { amount: 2_000_000, currency: "USD" },
          period: { start: "2024-01-01", end: "2024-12-31" },
          currency: "USD",
          scale: "units",
          signConvention: "all_positive",
        },
        normalizedFacts: [
          {
            canonicalKey: "borrower.legal_name",
            value: "Acme Manufacturing LLC",
            type: "string",
          },
        ],
      };
    }
    if (
      name === "run_financial_statement_spread" ||
      name === "quantitative_analysis_agent"
    ) {
      return { ok: true };
    }
    if (
      name === "run_professional_memo" ||
      name === "professional_memo_agent"
    ) {
      return { jobId: "job_memo_1", status: "PENDING" };
    }
    if (name === "get_memo_status") {
      this.memoPolls += 1;
      if (this.memoPolls <= this.options.memoDelayPolls) {
        return { status: "IN_PROGRESS", progress: 40, jobId: args["jobId"] };
      }
      return {
        status: "COMPLETED",
        progress: 100,
        memoId: "memo_1",
        decision: "REFER",
        sections: [
          {
            sectionType: "recommendation",
            title: "Recommendation",
            content: "REFER pending additional tax returns.",
            orderIndex: 1,
          },
        ],
      };
    }
    return { ok: true, name };
  }

  private sendJson(response: ServerResponse, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(200, {
      "content-type": "application/json",
      "mcp-session-id": "mock-session",
    });
    response.end(payload);
  }
}

export function documentFixture(
  overrides: Partial<{
    documentId: string;
    sourceId: string;
    title: string;
    mimeType: string;
    content: string;
    fileName: string;
  }> = {},
) {
  const content = overrides.content ?? "Revenue 5000000 EBITDA 2000000";
  return {
    documentId: overrides.documentId ?? "doc_001",
    sourceId: overrides.sourceId ?? "src_document_001",
    title: overrides.title ?? "Financial statement",
    mimeType: overrides.mimeType ?? "text/plain",
    pageCount: 1,
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
    pages: [{ pageNumber: 1, text: content }],
    ...(overrides.fileName ? { fileName: overrides.fileName } : {}),
  };
}

export function guardedFetch(impl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (
      url.includes("agents.securelend.ai") ||
      url.includes("api.securelend.ai")
    ) {
      throw new Error(`Refusing production SecureLend URL ${url}`);
    }
    return impl(input, init);
  };
}
