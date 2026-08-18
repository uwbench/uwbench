import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readAdapterConfig,
  readMcpToken,
  readParticipantIdentity,
} from "./identity.js";

const required = {
  SECURELEND_MODEL: "claude-sonnet-4-6",
};

describe("adapter identity and mode selection", () => {
  it("requires SECURELEND_MODEL as an identity label", () => {
    expect(() => readParticipantIdentity({})).toThrow(/SECURELEND_MODEL/);
  });

  it("selects protocol-proxy mode when SECURELEND_AGENT_URL is set", () => {
    const config = readAdapterConfig({
      ...required,
      SECURELEND_AGENT_URL: "http://127.0.0.1:8080/",
      SECURELEND_MCP_URL: "https://agents.securelend.ai/mcp",
    });
    expect(config.mode).toBe("protocol");
    expect(config.protocolUpstream).toBe("http://127.0.0.1:8080");
  });

  it("selects MCP chat-path mode from token env", () => {
    const config = readAdapterConfig({
      ...required,
      SECURELEND_MCP_URL: "https://agents.securelend.ai/mcp",
      SECURELEND_MCP_TOKEN: "Bearer secret-token",
      SECURELEND_DOCUMENT_API_URL:
        "https://api.securelend.ai/api/document/internal/process-uploaded-document",
    });
    expect(config.mode).toBe("mcp");
    expect(config.mcp?.url).toBe("https://agents.securelend.ai/mcp");
    expect(config.mcp?.token).toBe("secret-token");
    expect(config.mcp?.documentApiUrl).toContain("process-uploaded-document");
  });

  it("reads the bearer value from SECURELEND_MCP_TOKEN_FILE", () => {
    const dir = mkdtempSync(join(tmpdir(), "uwbench-sl-token-"));
    const file = join(dir, "token");
    writeFileSync(file, "file-token\n");
    try {
      expect(readMcpToken({ SECURELEND_MCP_TOKEN_FILE: file })).toBe(
        "file-token",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explains the two modes when neither URL is set", () => {
    expect(() => readAdapterConfig({ ...required })).toThrow(
      /SECURELEND_AGENT_URL|SECURELEND_MCP_URL/,
    );
  });
});
