import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loabAgentsRoot } from "./clone.js";

export interface LoabDecisionRule {
  terminal: boolean;
  handoff_required: boolean;
  next_agent: string | null;
  advance_workflow: boolean;
}

export interface LoabAgentContract {
  agent: string;
  prompt: string;
  allowedTools: string[];
  validDecisions: Record<string, LoabDecisionRule>;
  policySections: string[];
}

export function loadAgentContract(
  root: string,
  agent: string,
): LoabAgentContract {
  const promptPath = join(loabAgentsRoot(root), agent, "prompt.md");
  if (!existsSync(promptPath)) {
    throw new Error(`Missing LOAB agent prompt: ${promptPath}`);
  }
  const prompt = readFileSync(promptPath, "utf8");
  const contract = parseFencedJson(prompt, "decision_contract");
  const valid = asRecord(asRecord(contract)["valid_decisions"]);
  if (Object.keys(valid).length === 0) {
    throw new Error(`Agent prompt missing decision_contract: ${promptPath}`);
  }
  const validDecisions: Record<string, LoabDecisionRule> = {};
  for (const [name, raw] of Object.entries(valid)) {
    const rule = asRecord(raw);
    const terminal = rule["terminal"] === true;
    const handoffRequired = rule["handoff_required"] === true;
    const nextAgent =
      typeof rule["next_agent"] === "string" ? rule["next_agent"] : null;
    validDecisions[name] = {
      terminal,
      handoff_required: handoffRequired,
      next_agent: nextAgent,
      advance_workflow:
        typeof rule["advance_workflow"] === "boolean"
          ? rule["advance_workflow"]
          : !terminal && Boolean(nextAgent),
    };
  }
  return {
    agent,
    prompt,
    allowedTools: extractAllowedToolNames(prompt),
    validDecisions,
    policySections: extractPolicySectionIds(prompt),
  };
}

export function parseFencedJson(text: string, label: string): unknown {
  const match = text.match(
    new RegExp(`\`\`\`${label}\\n([\\s\\S]*?)\\n\`\`\``),
  );
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return undefined;
  }
}

export function extractAllowedToolNames(agentPrompt: string): string[] {
  const start = agentPrompt.search(/^## Tools available\s*$/m);
  if (start < 0) return [];
  const fromHeading = agentPrompt.slice(start);
  const nextHeading = fromHeading.slice(1).search(/^## /m);
  const section =
    nextHeading >= 0 ? fromHeading.slice(0, nextHeading + 1) : fromHeading;
  const names = new Set<string>();
  for (const toolSig of section.matchAll(/`([^`]+)`/g)) {
    const name = toolSig[1]?.split("(", 1)[0]?.trim();
    if (name) names.add(name);
  }
  return [...names];
}

export function extractPolicySectionIds(agentPrompt: string): string[] {
  const ids = new Set<string>();
  for (const match of agentPrompt.matchAll(/`?(Section\s+\d+(?:\.\d+)?)`?/g)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
