import { ADAPTER_NAME, ADAPTER_VERSION } from "./identity.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpClientOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class McpClientError extends Error {
  readonly code?: number | undefined;
  readonly data?: unknown;

  constructor(
    message: string,
    options: { code?: number; data?: unknown } = {},
  ) {
    super(message);
    this.name = "McpClientError";
    this.code = options.code;
    this.data = options.data;
  }
}

/**
 * Minimal MCP Streamable HTTP / JSON-RPC 2.0 client for tools/call.
 * Does not register OAuth clients or call production unless `url` points there.
 */
export class McpClient {
  readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private sessionId: string | undefined;
  private nextId = 1;

  constructor(options: McpClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async initialize(): Promise<void> {
    try {
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: ADAPTER_NAME, version: ADAPTER_VERSION },
      });
      await this.notify("notifications/initialized", {});
    } catch {
      // Some MCP hosts accept tools/call without a prior initialize.
    }
  }

  async listToolNames(): Promise<string[]> {
    const result = await this.request("tools/list", {});
    const tools = asRecord(result)?.["tools"];
    if (!Array.isArray(tools)) return [];
    return tools
      .map((tool) => {
        const name = asRecord(tool)?.["name"];
        return typeof name === "string" ? name : undefined;
      })
      .filter((name): name is string => Boolean(name));
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    return unwrapMcpToolResult(result);
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params }, false);
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    const parsed = await this.post({ ...body }, true);
    if (parsed.error) {
      throw new McpClientError(parsed.error.message, {
        code: parsed.error.code,
        data: parsed.error.data,
      });
    }
    return parsed.result;
  }

  private async post(
    payload: Record<string, unknown>,
    expectResponse: boolean,
  ): Promise<JsonRpcResponse> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2024-11-05",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (!expectResponse) {
      return { jsonrpc: "2.0" };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new McpClientError(
        `MCP HTTP ${response.status}${text ? `: ${text.slice(0, 400)}` : ""}`,
      );
    }
    const parsed = await parseMcpHttpBody(response);
    return parsed;
  }
}

const MEMO_SIBLING_KEYS = [
  "claims",
  "citedClaims",
  "risks",
  "riskFindings",
  "recommendation",
  "decision",
  "sections",
  "markdown",
  "memo",
  "status",
  "memoId",
] as const;

export function unwrapMcpToolResult(result: unknown): unknown {
  const record = asRecord(result);
  if (!record) return result;
  if (record["isError"] === true) {
    const message =
      textFromMcpContent(record["content"]) ??
      stringifyUnknown(record["error"] ?? result);
    // Live run_data_extraction used to fail closed on AI GET 401/500.
    // That is a lookup miss, not a Textract failure — keep polling.
    if (/extraction service unavailable/i.test(message)) {
      const structured = asRecord(record["structuredContent"]) ?? {};
      return { ready: false, message, ...structured };
    }
    throw new McpClientError(message);
  }
  const structured = record["structuredContent"];
  const fromText = parseJsonText(textFromMcpContent(record["content"]));
  const siblings: Record<string, unknown> = {};
  for (const key of MEMO_SIBLING_KEYS) {
    if (record[key] !== undefined) siblings[key] = record[key];
  }
  const structuredRecord = asRecord(structured);
  const textRecord = asRecord(fromText);
  if (structuredRecord || textRecord || Object.keys(siblings).length > 0) {
    return {
      ...(structuredRecord ?? {}),
      ...(textRecord ?? {}),
      ...siblings,
    };
  }
  if (structured !== undefined) return structured;
  if (fromText !== undefined) return fromText;
  const text = textFromMcpContent(record["content"]);
  if (text !== undefined) return text;
  return result;
}

function parseJsonText(text: string | undefined): unknown {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function firstString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function nestedRecord(
  value: unknown,
  ...keys: string[]
): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of keys) {
    current = asRecord(current)?.[key];
  }
  return asRecord(current);
}

function textFromMcpContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((item) => {
      const record = asRecord(item);
      if (!record) return undefined;
      if (record["type"] === "text" && typeof record["text"] === "string") {
        return record["text"];
      }
      if (typeof record["text"] === "string") return record["text"];
      return undefined;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("\n") : undefined;
}

async function parseMcpHttpBody(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLines = raw
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== "[DONE]");
    const last = dataLines.at(-1);
    if (!last) {
      throw new McpClientError("MCP SSE response had no data");
    }
    return JSON.parse(last) as JsonRpcResponse;
  }
  if (raw.trim().length === 0) {
    return { jsonrpc: "2.0", id: null };
  }
  return JSON.parse(raw) as JsonRpcResponse;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
