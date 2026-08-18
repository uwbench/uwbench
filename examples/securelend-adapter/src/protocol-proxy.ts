import type { IncomingMessage, ServerResponse } from "node:http";
import { hopByHop, readBody } from "./http.js";

export async function proxyToProtocolAgent(
  upstream: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
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
