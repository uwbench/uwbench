import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import process from "node:process";
import { HealthResponseSchema } from "@uwbench/protocol";
import {
  ADAPTER_VERSION,
  readParticipantIdentity,
  readUpstreamUrl,
} from "./identity.js";

const hopByHop = new Set([
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

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(
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

async function proxy(
  upstream: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://127.0.0.1`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (!value || hopByHop.has(name.toLowerCase())) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = request.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = new Uint8Array(await readBody(request));
  }
  const upstreamResponse = await fetch(
    `${upstream}${url.pathname}${url.search}`,
    init,
  );
  response.writeHead(upstreamResponse.status, {
    "content-type":
      upstreamResponse.headers.get("content-type") ?? "application/json",
  });
  response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
}

async function main(): Promise<void> {
  const upstream = readUpstreamUrl();
  const participant = readParticipantIdentity();
  const port = Number.parseInt(process.env["PORT"] ?? "9200", 10);
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(
          response,
          200,
          HealthResponseSchema.parse({
            schemaVersion: "1.0",
            status: "ok",
            version: ADAPTER_VERSION,
            protocolVersion: "1.0",
            participant,
          }),
        );
        return;
      }
      await proxy(upstream, request, response);
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 502, {
          schemaVersion: "1.0",
          code: "AGENT_CRASHED",
          message:
            error instanceof Error
              ? error.message
              : "SecureLend upstream request failed",
          requestId: "securelend-adapter",
        });
      }
    });
  });

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(port, "127.0.0.1");
  });
  console.log(
    `[securelend-adapter] ${participant.harness} model=${participant.model} → ${upstream} on http://127.0.0.1:${port}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[securelend-adapter]",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
