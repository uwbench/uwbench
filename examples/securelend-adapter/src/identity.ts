import { readFileSync } from "node:fs";
import process from "node:process";
import type { ParticipantIdentity } from "@uwbench/protocol";

export const ADAPTER_NAME = "@uwbench/securelend-adapter";
export const ADAPTER_VERSION = "0.1.0";
export const HARNESS_ID = "securelend-underwriting-agent";

export type AdapterMode = "protocol" | "mcp";

export interface McpModeConfig {
  url: string;
  token: string;
  documentApiUrl?: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export interface AdapterConfig {
  mode: AdapterMode;
  participant: ParticipantIdentity;
  protocolUpstream?: string;
  mcp?: McpModeConfig;
}

function env(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = source[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function optionalEnv(
  source: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = source[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function readParticipantIdentity(
  source: NodeJS.ProcessEnv = process.env,
): ParticipantIdentity {
  const model = source["SECURELEND_MODEL"]?.trim();
  if (!model) {
    throw new Error(
      "SECURELEND_MODEL is required so published cells record the model that produced the score.",
    );
  }
  return {
    harness: HARNESS_ID,
    harnessVersion: env(source, "SECURELEND_HARNESS_VERSION", "undeclared"),
    model,
    modelVersion: env(source, "SECURELEND_MODEL_VERSION", "undeclared"),
    provider: env(source, "SECURELEND_PROVIDER", "undeclared"),
    providerVersion: env(source, "SECURELEND_PROVIDER_VERSION", "undeclared"),
    adapter: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
  };
}

export function readMcpToken(source: NodeJS.ProcessEnv = process.env): string {
  const inline = optionalEnv(source, "SECURELEND_MCP_TOKEN");
  const filePath = optionalEnv(source, "SECURELEND_MCP_TOKEN_FILE");
  if (inline && filePath) {
    throw new Error(
      "Set only one of SECURELEND_MCP_TOKEN or SECURELEND_MCP_TOKEN_FILE.",
    );
  }
  let token = inline;
  if (!token && filePath) {
    token = readFileSync(filePath, "utf8").trim();
  }
  if (!token) {
    throw new Error(
      "MCP mode requires SECURELEND_MCP_TOKEN or SECURELEND_MCP_TOKEN_FILE (Bearer token value only, no 'Bearer ' prefix).",
    );
  }
  return token.replace(/^Bearer\s+/i, "").trim();
}

export function readAdapterConfig(
  source: NodeJS.ProcessEnv = process.env,
): AdapterConfig {
  const participant = readParticipantIdentity(source);
  const protocolUpstream = optionalEnv(source, "SECURELEND_AGENT_URL")?.replace(
    /\/$/,
    "",
  );
  const mcpUrl = optionalEnv(source, "SECURELEND_MCP_URL")?.replace(/\/$/, "");

  if (protocolUpstream) {
    const config: AdapterConfig = {
      mode: "protocol",
      participant,
      protocolUpstream,
    };
    return config;
  }

  if (mcpUrl) {
    const documentApiUrl = optionalEnv(source, "SECURELEND_DOCUMENT_API_URL");
    const mcp: McpModeConfig = {
      url: mcpUrl,
      token: readMcpToken(source),
      pollIntervalMs: parsePositiveInt(
        source["SECURELEND_MCP_POLL_INTERVAL_MS"],
        2_000,
        "SECURELEND_MCP_POLL_INTERVAL_MS",
      ),
      pollTimeoutMs: parsePositiveInt(
        source["SECURELEND_MCP_POLL_TIMEOUT_MS"],
        180_000,
        "SECURELEND_MCP_POLL_TIMEOUT_MS",
      ),
      ...(documentApiUrl ? { documentApiUrl } : {}),
    };
    return {
      mode: "mcp",
      participant,
      mcp,
    };
  }

  throw new Error(
    "Set SECURELEND_AGENT_URL for protocol-proxy mode (GET /health + POST/GET/DELETE /v1/runs) or SECURELEND_MCP_URL for the live product chat path (MCP tools/call).",
  );
}
