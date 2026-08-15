import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_NAMES } from "@uwbench/protocol";
import type { HarnessIdentity } from "@uwbench/testkit";
import { HarnessAdapter } from "./adapter.js";
import {
  CONTROLLED_BOUNDARY,
  type HarnessCapabilityDeclaration,
  type HarnessProfileId,
} from "./capabilities.js";
import { ADAPTER_VERSION, type HarnessCommand } from "./types.js";

export interface HarnessProfile {
  id: HarnessProfileId;
  identity: HarnessIdentity;
  declaration: HarnessCapabilityDeclaration;
  liveBinary: string;
}

function identity(
  harness: HarnessProfileId,
  provider: string,
): HarnessIdentity {
  return {
    harness,
    harnessVersion: "1.0.0",
    model: "fixture",
    modelVersion: "none",
    provider,
    providerVersion: "none",
    adapter: `@uwbench/harness-adapter/${harness}`,
    adapterVersion: ADAPTER_VERSION,
    prompt: "none",
    promptVersion: "none",
    scorer: "none",
    scorerVersion: "none",
  };
}

function declaration(
  harness: HarnessProfileId,
  raw: {
    filesystem: string;
    network: string;
    memory: string;
    approval: string;
    connectors: string[];
    notes: string[];
  },
): HarnessCapabilityDeclaration {
  return {
    harness,
    filesystem: {
      raw: raw.filesystem,
      controlled: CONTROLLED_BOUNDARY.filesystem,
      normalized: true,
    },
    network: {
      raw: raw.network,
      controlled: CONTROLLED_BOUNDARY.network,
      normalized: true,
    },
    memory: {
      raw: raw.memory,
      controlled: CONTROLLED_BOUNDARY.memory,
      normalized: true,
    },
    approval: {
      raw: raw.approval,
      controlled: CONTROLLED_BOUNDARY.approval,
      normalized: true,
    },
    connectors: {
      raw: raw.connectors,
      controlled: [...CONTROLLED_BOUNDARY.connectors],
      normalized: true,
    },
    notes: raw.notes,
  };
}

export const CLAUDE_CODE_PROFILE: HarnessProfile = {
  id: "claude-code",
  identity: identity("claude-code", "anthropic"),
  liveBinary: "claude",
  declaration: declaration("claude-code", {
    filesystem: "host-visible workspace plus CLAUDE.md lookup",
    network: "optional web fetch and MCP transports",
    memory: "retained CLAUDE.md / memory files across sessions",
    approval: "interactive permission prompts",
    connectors: ["mcp"],
    notes: [
      "Controlled runs replace the host workspace with an ephemeral directory.",
      "Repository instructions, memory, and MCP connectors are disabled.",
    ],
  }),
};

export const CODEX_PROFILE: HarnessProfile = {
  id: "codex",
  identity: identity("codex", "openai"),
  liveBinary: "codex",
  declaration: declaration("codex", {
    filesystem: "host-visible workspace plus AGENTS.md lookup",
    network: "sandbox-dependent outbound access",
    memory: "retained AGENTS.md and session history",
    approval: "approval-mode operator prompts",
    connectors: [],
    notes: [
      "Controlled runs pin an ephemeral workspace and deny retained instructions.",
      "Approval prompts are removed; only authorized benchmark tools remain.",
    ],
  }),
};

export const GEMINI_CLI_PROFILE: HarnessProfile = {
  id: "gemini-cli",
  identity: identity("gemini-cli", "google"),
  liveBinary: "gemini",
  declaration: declaration("gemini-cli", {
    filesystem: "host-visible workspace plus GEMINI.md lookup",
    network: "optional web and MCP transports",
    memory: "retained GEMINI.md / conversation memory",
    approval: "interactive tool-approval prompts",
    connectors: ["mcp"],
    notes: [
      "Controlled runs isolate state to a deleted-after-run workspace.",
      "MCP connectors and repository instructions are not loaded.",
    ],
  }),
};

export const CONTROLLED_PROFILES: Record<HarnessProfileId, HarnessProfile> = {
  "claude-code": CLAUDE_CODE_PROFILE,
  codex: CODEX_PROFILE,
  "gemini-cli": GEMINI_CLI_PROFILE,
};

export function fixtureWorkerPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../workers/complete.mjs",
  );
}

export function fixtureCommand(
  env: Record<string, string> = {},
): HarnessCommand {
  return {
    command: process.execPath,
    args: [fixtureWorkerPath()],
    env,
  };
}

export interface ControlledAdapterOptions {
  port: number;
  live?: boolean;
  authorizedTools?: readonly string[];
  env?: Record<string, string>;
}

export function createControlledAdapter(
  profileId: HarnessProfileId,
  options: ControlledAdapterOptions,
): HarnessAdapter {
  const profile = CONTROLLED_PROFILES[profileId];
  const live = options.live === true;
  if (live) {
    throw new Error(
      `${profile.liveBinary} live mode is opt-in and not used for protocol conformance`,
    );
  }
  const adapterOptions = {
    port: options.port,
    command: fixtureCommand(options.env ?? {}),
    identity: profile.identity,
    authorizedTools: options.authorizedTools ?? TOOL_NAMES,
    declaration: profile.declaration,
  };
  return new HarnessAdapter(adapterOptions);
}
