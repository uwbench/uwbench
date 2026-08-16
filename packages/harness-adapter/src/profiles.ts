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
  liveProvider?: string;
  liveModel?: string;
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

export const PI_NEMOTRON_PROFILE: HarnessProfile = {
  id: "pi-nemotron",
  identity: identity("pi-nemotron", "nvidia"),
  liveBinary: "pi",
  liveProvider: "nvidia",
  liveModel: "nvidia/nemotron-3-super-120b-a12b",
  declaration: declaration("pi-nemotron", {
    filesystem: "host-visible workspace plus AGENTS.md / CLAUDE.md lookup",
    network: "NVIDIA NIM API plus optional tool HTTP",
    memory: "retained pi session files under ~/.pi",
    approval: "interactive tool prompts unless print mode",
    connectors: ["nvidia-nim"],
    notes: [
      "Controlled live runs use `pi -p --no-session --no-context-files`.",
      "Default model is nvidia/nemotron-3-super-120b-a12b; override with UWBENCH_LIVE_MODEL.",
    ],
  }),
};

export const PI_GLM_52_PROFILE: HarnessProfile = {
  id: "pi-glm-5.2",
  identity: identity("pi-glm-5.2", "nvidia"),
  liveBinary: "pi",
  liveProvider: "nvidia",
  liveModel: "z-ai/glm-5.2",
  declaration: declaration("pi-glm-5.2", {
    filesystem: "host-visible workspace plus AGENTS.md / CLAUDE.md lookup",
    network: "NVIDIA NIM API plus optional tool HTTP",
    memory: "retained pi session files under ~/.pi",
    approval: "interactive tool prompts unless print mode",
    connectors: ["nvidia-nim"],
    notes: [
      "Controlled live runs use `pi -p --no-session --no-context-files`.",
      "Default model is z-ai/glm-5.2; override with UWBENCH_LIVE_MODEL.",
    ],
  }),
};

export const PI_GROK_46_PROFILE: HarnessProfile = {
  id: "pi-grok-4.6",
  identity: identity("pi-grok-4.6", "xai"),
  liveBinary: "pi",
  liveProvider: "xai",
  liveModel: "grok-4.6",
  declaration: declaration("pi-grok-4.6", {
    filesystem: "host-visible workspace plus AGENTS.md / CLAUDE.md lookup",
    network: "xAI API plus optional tool HTTP",
    memory: "retained pi session files under ~/.pi",
    approval: "interactive tool prompts unless print mode",
    connectors: ["xai"],
    notes: [
      "Controlled live runs use `pi -p --no-session --no-context-files`.",
      "Default model is xai/grok-4.6 (built-in Pi catalog; XAI_API_KEY or `/login xai`).",
      "Optional SuperGrok path: `pi install npm:pi-grok-cli`, then UWBENCH_LIVE_PROVIDER=grok-cli.",
      "Override with UWBENCH_LIVE_PROVIDER / UWBENCH_LIVE_MODEL.",
    ],
  }),
};

export const OPENCODE_PROFILE: HarnessProfile = {
  id: "opencode",
  identity: identity("opencode", "opencode"),
  liveBinary: "opencode",
  declaration: declaration("opencode", {
    filesystem:
      "host-visible workspace plus AGENTS.md / CLAUDE.md / .opencode lookup",
    network: "provider API plus optional MCP / web tools",
    memory: "retained OpenCode sessions under ~/.local/share/opencode",
    approval: "interactive permission prompts unless --auto",
    connectors: ["mcp"],
    notes: [
      "Controlled live runs use `opencode --pure run --auto` in the ephemeral workspace.",
      "Uses the locally configured OpenCode model; pin with UWBENCH_LIVE_MODEL (provider/model).",
    ],
  }),
};

export const CONTROLLED_PROFILES: Record<HarnessProfileId, HarnessProfile> = {
  "claude-code": CLAUDE_CODE_PROFILE,
  codex: CODEX_PROFILE,
  "gemini-cli": GEMINI_CLI_PROFILE,
  "pi-nemotron": PI_NEMOTRON_PROFILE,
  "pi-glm-5.2": PI_GLM_52_PROFILE,
  "pi-grok-4.6": PI_GROK_46_PROFILE,
  opencode: OPENCODE_PROFILE,
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

export function liveWorkerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../workers/live.mjs");
}

export function liveCommand(
  binary: string,
  env: Record<string, string> = {},
): HarnessCommand {
  return {
    command: process.execPath,
    args: [liveWorkerPath()],
    env: {
      UWBENCH_LIVE_BIN: binary,
      ...env,
    },
  };
}

function liveEnv(profile: HarnessProfile): Record<string, string> {
  const env: Record<string, string> = {};
  if (profile.liveProvider) env["UWBENCH_LIVE_PROVIDER"] = profile.liveProvider;
  if (profile.liveModel) env["UWBENCH_LIVE_MODEL"] = profile.liveModel;
  return env;
}

export function createControlledAdapter(
  profileId: HarnessProfileId,
  options: ControlledAdapterOptions,
): HarnessAdapter {
  const profile = CONTROLLED_PROFILES[profileId];
  const live = options.live === true;
  const identity = live
    ? {
        ...profile.identity,
        model: profile.liveModel ?? "live",
        modelVersion: "undeclared",
      }
    : profile.identity;
  return new HarnessAdapter({
    port: options.port,
    command: live
      ? liveCommand(profile.liveBinary, {
          ...liveEnv(profile),
          ...options.env,
        })
      : fixtureCommand(options.env ?? {}),
    identity,
    authorizedTools: options.authorizedTools ?? TOOL_NAMES,
    declaration: profile.declaration,
  });
}
