import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProtocolError, ProtocolErrorCode } from "@uwbench/protocol";

export const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request);
  if (body.length === 0) return undefined;
  return JSON.parse(body.toString("utf8")) as unknown;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function protocolError(
  code: ProtocolErrorCode,
  message: string,
  requestId = "securelend-adapter",
): ProtocolError {
  return {
    schemaVersion: "1.0",
    code,
    message,
    requestId,
  };
}
