import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const WORKER = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../workers/live.mjs",
);

function runWorker(request: Record<string, unknown>): Promise<string> {
  const workspace = mkdtempSync(join(tmpdir(), "uwbench-live-prompt-"));
  writeFileSync(
    join(workspace, "request.json"),
    `${JSON.stringify(request)}\n`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER], {
      env: {
        ...process.env,
        UWBENCH_WORKSPACE: workspace,
        UWBENCH_LIVE_BIN: "true",
      },
    });
    child.on("error", reject);
    child.on("exit", () => {
      resolve(readFileSync(join(workspace, "PROMPT.md"), "utf8"));
    });
  });
}

const request = {
  caseId: "case-00002",
  lane: "reasoning_only",
  objective: "Underwrite a term loan.",
  requiredOutputs: ["follow_up_requests"],
  taskMarkdown:
    "## Missing Information\n5. **ai_agent_initiated_spend_share**\n",
};

describe("reasoning_only live prompt", () => {
  it("includes task.md and still keeps the objective", async () => {
    const prompt = await runWorker(request);
    expect(prompt).toContain("Objective: Underwrite a term loan.");
    expect(prompt).toContain("Case task (task.md):");
    expect(prompt).toContain("ai_agent_initiated_spend_share");
    expect(prompt).toContain("policy.search indexes every declared policy");
  });

  it("does not paste task.md on other lanes", async () => {
    const prompt = await runWorker({ ...request, lane: "raw_documents" });
    expect(prompt).not.toContain("Case task (task.md):");
    expect(prompt).not.toContain("ai_agent_initiated_spend_share");
    expect(prompt).toContain("Objective: Underwrite a term loan.");
  });
});
