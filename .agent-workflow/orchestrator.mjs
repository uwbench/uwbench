#!/usr/bin/env node
/**
 * Dependency-aware local workflow state machine.
 *
 * This file intentionally uses only Node.js built-ins so it can run before T1
 * creates package.json or installs tsx.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(WORKFLOW_DIR, "..");
const TASKS_FILE = join(WORKFLOW_DIR, "TASKS.json");
const HISTORY_FILE = join(WORKFLOW_DIR, "STATE.ndjson");
const LOCK_FILE = join(WORKFLOW_DIR, ".orchestrator.lock");
const VALID_STATUSES = new Set([
  "pending",
  "in_progress",
  "gated_pass",
  "blocked",
]);
const COMPLETE_STATUSES = new Set(["gated_pass"]);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

function withLock(action) {
  let fd;
  try {
    if (existsSync(LOCK_FILE)) {
      const ageMs = Date.now() - statSync(LOCK_FILE).mtimeMs;
      if (ageMs > 10 * 60 * 1000) rmSync(LOCK_FILE);
    }
    fd = openSync(LOCK_FILE, "wx");
    writeFileSync(fd, `${process.pid}\n`);
    return action();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("another orchestrator command is running (or remove a stale .orchestrator.lock)");
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(LOCK_FILE, { force: true });
  }
}

function loadTasks() {
  if (!existsSync(TASKS_FILE)) throw new Error(`${TASKS_FILE} does not exist`);
  const parsed = JSON.parse(readFileSync(TASKS_FILE, "utf8"));
  validateTasks(parsed);
  return parsed;
}

function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("TASKS.json must be a non-empty array");
  }

  const ids = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== "object") throw new Error("every task must be an object");
    if (!task.id || ids.has(task.id)) throw new Error(`duplicate or missing task id: ${task.id}`);
    ids.add(task.id);
    if (!VALID_STATUSES.has(task.status)) {
      throw new Error(`${task.id} has invalid status '${task.status}'`);
    }
    if (!Array.isArray(task.depends_on)) throw new Error(`${task.id}.depends_on must be an array`);
    if (!Array.isArray(task.acceptance) || task.acceptance.length === 0) {
      throw new Error(`${task.id} must have acceptance criteria`);
    }
    if (!Array.isArray(task.files_touched)) throw new Error(`${task.id}.files_touched must be an array`);
    if (task.scope_exceptions !== undefined && !Array.isArray(task.scope_exceptions)) {
      throw new Error(`${task.id}.scope_exceptions must be an array when present`);
    }
    if (
      task.implementation_constraints !== undefined
      && (
        !Array.isArray(task.implementation_constraints)
        || task.implementation_constraints.some(
          (constraint) => typeof constraint !== "string" || constraint.trim().length === 0,
        )
      )
    ) {
      throw new Error(
        `${task.id}.implementation_constraints must contain only non-empty strings when present`,
      );
    }
    for (const counter of ["attempts", "failures", "deferrals", "review_failures"]) {
      if (
        task[counter] !== undefined
        && (!Number.isInteger(task[counter]) || task[counter] < 0)
      ) {
        throw new Error(`${task.id}.${counter} must be a non-negative integer when present`);
      }
    }
    for (const limit of ["failure_limit", "review_failure_limit"]) {
      if (
        task[limit] !== undefined
        && (!Number.isInteger(task[limit]) || task[limit] < 1)
      ) {
        throw new Error(`${task.id}.${limit} must be a positive integer when present`);
      }
    }
  }

  for (const task of tasks) {
    for (const dependency of task.depends_on) {
      if (!ids.has(dependency)) throw new Error(`${task.id} depends on unknown task ${dependency}`);
      if (dependency === task.id) throw new Error(`${task.id} cannot depend on itself`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  function visit(id) {
    if (visiting.has(id)) throw new Error(`dependency cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);
}

function saveTasks(tasks, event) {
  validateTasks(tasks);
  atomicWrite(TASKS_FILE, `${JSON.stringify(tasks, null, 2)}\n`);
  appendFileSync(
    HISTORY_FILE,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
  );
}

function taskById(tasks, id) {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`task ${id} not found`);
  return task;
}

function dependencyState(tasks, task) {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const waiting = task.depends_on.filter((id) => !COMPLETE_STATUSES.has(byId.get(id)?.status));
  return { ready: waiting.length === 0, waiting };
}

function activeTasks(tasks) {
  return tasks.filter((task) => task.status === "in_progress");
}

function readyTasks(tasks) {
  return tasks
    .filter((task) => task.status === "pending" && dependencyState(tasks, task).ready)
    .sort((a, b) =>
      (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
      || a.phase - b.phase
      || a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
}

function taskPrompt(task, tasks) {
  const dependencies = task.depends_on.length
    ? task.depends_on
      .map((id) => {
        const dependency = taskById(tasks, id);
        return `- ${id}: ${dependency.title} (${dependency.status})`;
      })
      .join("\n")
    : "- None";
  const priorFeedback = task.review_notes
    ? `\n## Prior gate or checkpoint feedback\n${task.review_notes}\n`
    : "";
  const scopeExceptions = task.scope_exceptions?.length
    ? `\n## Allowed repair scope\nThese paths may be changed only when necessary to satisfy this task or its cumulative gate:\n${task.scope_exceptions.map((path) => `- \`${path}\``).join("\n")}\n`
    : "";
  const implementationConstraints = task.implementation_constraints?.length
    ? `\n## Task-specific constraints\n${task.implementation_constraints.map((constraint) => `- ${constraint}`).join("\n")}\n`
    : "";

  return `# Task ${task.id}: ${task.title}

## Objective
${task.description}

## Phase and attempt
- Phase: ${task.phase}
- Priority: ${task.priority}
- Estimated effort: ${task.estimated_minutes} minutes
- Attempt: ${(task.attempts ?? 0) + 1}

## Dependencies
${dependencies}
${priorFeedback}
## Acceptance criteria
${task.acceptance.map((criterion) => `- [ ] ${criterion}`).join("\n")}

## Intended files
${task.files_touched.map((path) => `- \`${path}\``).join("\n")}
${scopeExceptions}
${implementationConstraints}

## Required context
Read these repository-relative files completely before editing:

- \`.agent-workflow/SPEC.md\`
- \`.agent-workflow/PLAN.md\`
- \`.agent-workflow/TASKS.json\`

## Implementation rules

1. Work only on this task and its necessary tests/configuration.
2. Preserve existing user changes and do not edit task state in \`.agent-workflow/TASKS.json\`.
3. Do not commit. The orchestrator independently gates, applies, and commits a passing patch.
4. Use pnpm and the repository's pinned package manager.
5. Run the strongest available checks. At minimum run \`pnpm typecheck\` and \`pnpm test\` once those scripts exist.
6. Do not claim a check passed unless its command completed successfully.
7. Do not add generated artifacts that disagree with their source schemas.
8. On a retry, address the prior feedback even if a narrowly scoped dependency-owned file must change.
9. Finish with a concise summary containing changed files, commands run, results, and any remaining blocker.
10. Run \`git diff --check\` before finishing and remove every whitespace error it reports.
`;
}

function commandValidate() {
  const tasks = loadTasks();
  const active = activeTasks(tasks);
  console.log(`Valid TASKS.json: ${tasks.length} tasks, ${active.length} active.`);
}

function commandNext(requestedId) {
  withLock(() => {
    const tasks = loadTasks();
    const active = activeTasks(tasks);
    if (active.length) {
      throw new Error(
        `finish the active task first: ${active.map((task) => `${task.id} (${task.status})`).join(", ")}`,
      );
    }

    let task;
    if (requestedId) {
      task = taskById(tasks, requestedId);
      if (task.status !== "pending") throw new Error(`${task.id} is ${task.status}, not pending`);
      const dependencies = dependencyState(tasks, task);
      if (!dependencies.ready) {
        throw new Error(`${task.id} is waiting on ${dependencies.waiting.join(", ")}`);
      }
    } else {
      task = readyTasks(tasks)[0];
    }

    if (!task) {
      const unfinished = tasks.filter((candidate) => !COMPLETE_STATUSES.has(candidate.status));
      if (unfinished.length) {
        throw new Error("no task is ready; inspect blocked or failed dependencies with `status`");
      }
      console.log("All tasks passed their deterministic gates.");
      return;
    }

    const taskFile = join(WORKFLOW_DIR, `TASK_${task.id}.md`);
    atomicWrite(taskFile, taskPrompt(task, tasks));
    task.status = "in_progress";
    task.assignee = "pi";
    task.started_at = new Date().toISOString();
    task.completed_at = undefined;
    task.attempts = (task.attempts ?? 0) + 1;
    saveTasks(tasks, { command: "next", taskId: task.id, attempt: task.attempts });
    console.log(`Prepared ${taskFile}`);
    console.log(`TASK_ID=${task.id}`);
  });
}

function commandGatePass(taskId) {
  withLock(() => {
    const tasks = loadTasks();
    const task = taskById(tasks, taskId);
    if (task.status !== "in_progress") {
      throw new Error(`${task.id} is ${task.status}; expected in_progress`);
    }
    task.status = "gated_pass";
    task.assignee = "orchestrator";
    task.completed_at = new Date().toISOString();
    task.review_notes = undefined;
    saveTasks(tasks, { command: "gate-pass", taskId: task.id, attempt: task.attempts });
    console.log(`Deterministic gate passed for ${task.id}.`);
  });
}

function commandGateFail(taskId, reason) {
  if (!reason?.trim()) throw new Error("gate-fail requires a non-empty reason");
  withLock(() => {
    const tasks = loadTasks();
    const task = taskById(tasks, taskId);
    if (task.status !== "in_progress") {
      throw new Error(`${task.id} is ${task.status}; expected in_progress`);
    }
    task.status = "pending";
    task.assignee = "pi";
    task.completed_at = undefined;
    task.review_notes = reason.trim();
    task.failures = (task.failures ?? 0) + 1;
    saveTasks(tasks, {
      command: "gate-fail",
      taskId: task.id,
      attempt: task.attempts,
      reason: reason.trim(),
    });
    console.log(`Gate failed for ${task.id}; it is pending for another attempt.`);
  });
}

function commandDefer(taskId, reason) {
  if (!reason?.trim()) throw new Error("defer requires a non-empty reason");
  withLock(() => {
    const tasks = loadTasks();
    const task = taskById(tasks, taskId);
    if (task.status !== "in_progress") {
      throw new Error(`${task.id} is ${task.status}; expected in_progress`);
    }
    task.status = "pending";
    task.assignee = "pi";
    task.completed_at = undefined;
    task.review_notes = reason.trim();
    task.deferrals = (task.deferrals ?? 0) + 1;
    saveTasks(tasks, {
      command: "defer",
      taskId: task.id,
      attempt: task.attempts,
      deferrals: task.deferrals,
      reason: reason.trim(),
    });
    console.log(`Deferred ${task.id} without counting an implementation failure.`);
  });
}

function commandReopen(taskId, reason) {
  if (!reason?.trim()) throw new Error("reopen requires a non-empty reason");
  withLock(() => {
    const tasks = loadTasks();
    const task = taskById(tasks, taskId);
    if (!COMPLETE_STATUSES.has(task.status)) {
      throw new Error(`${task.id} is ${task.status}; expected a completed task`);
    }
    const completedDependents = tasks.filter(
      (candidate) =>
        candidate.depends_on.includes(task.id) && COMPLETE_STATUSES.has(candidate.status),
    );
    if (completedDependents.length) {
      throw new Error(
        `${task.id} has completed dependents (${completedDependents.map((item) => item.id).join(", ")}); reopen before proceeding past its checkpoint`,
      );
    }
    task.status = "pending";
    task.assignee = "pi";
    task.completed_at = undefined;
    task.review_notes = reason.trim();
    task.review_failures = (task.review_failures ?? 0) + 1;
    saveTasks(tasks, {
      command: "reopen",
      taskId: task.id,
      attempt: task.attempts,
      reviewFailures: task.review_failures,
      reason: reason.trim(),
    });
    console.log(`Reopened ${task.id} with checkpoint feedback.`);
  });
}

function commandReset(taskId, reason) {
  withLock(() => {
    const tasks = loadTasks();
    const task = taskById(tasks, taskId);
    if (COMPLETE_STATUSES.has(task.status)) {
      throw new Error("completed tasks require `reopen` with checkpoint feedback");
    }
    task.status = "pending";
    task.assignee = undefined;
    task.started_at = undefined;
    task.completed_at = undefined;
    if (reason?.trim()) task.review_notes = reason.trim();
    saveTasks(tasks, { command: "reset", taskId: task.id, reason: reason?.trim() });
    console.log(`Reset ${task.id} to pending.`);
  });
}

function commandCurrent() {
  const tasks = loadTasks();
  const active = activeTasks(tasks);
  if (active.length === 0) return;
  if (active.length > 1) throw new Error(`multiple active tasks: ${active.map((task) => task.id).join(", ")}`);
  console.log(active[0].id);
}

function commandStatus() {
  const tasks = loadTasks();
  const ready = new Set(readyTasks(tasks).map((task) => task.id));
  console.log("UWBench workflow");
  for (const task of tasks) {
    const dependency = dependencyState(tasks, task);
    const marker = task.status === "gated_pass"
      ? "GATED"
      : task.status === "in_progress"
        ? "RUN "
        : task.status === "blocked"
          ? "BLOCK"
          : ready.has(task.id)
            ? "READY"
            : "WAIT";
    const waiting = dependency.waiting.length ? `; waits for ${dependency.waiting.join(",")}` : "";
    const attempt = task.attempts ? `; attempt ${task.attempts}` : "";
    const failures = task.failures ? `; failures ${task.failures}` : "";
    const deferrals = task.deferrals ? `; deferrals ${task.deferrals}` : "";
    const reviewFailures = task.review_failures ? `; review failures ${task.review_failures}` : "";
    console.log(
      `${marker.padEnd(6)} ${task.id.padEnd(4)} ${task.title} [${task.status}${attempt}${failures}${deferrals}${reviewFailures}${waiting}]`,
    );
  }
  const active = activeTasks(tasks);
  if (active.length) {
    console.log(`\nActive: ${active.map((task) => `${task.id} (${task.status})`).join(", ")}`);
  } else {
    const next = readyTasks(tasks)[0];
    console.log(next ? `\nNext ready: ${next.id} — ${next.title}` : "\nNo task ready.");
  }
}

function usage() {
  console.log(`Usage: node .agent-workflow/orchestrator.mjs <command>

Commands:
  validate
  status
  current
  next [task-id]
  gate-pass <task-id>
  gate-fail <task-id> <reason>
  defer <task-id> <transient-provider-reason>
  reopen <task-id> <checkpoint-feedback>
  reset <task-id> [reason]

Repository: ${REPO_ROOT}`);
}

const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "validate":
      commandValidate();
      break;
    case "status":
      commandStatus();
      break;
    case "current":
      commandCurrent();
      break;
    case "next":
      commandNext(args[0]);
      break;
    case "gate-pass":
      if (!args[0]) throw new Error("gate-pass requires a task id");
      commandGatePass(args[0]);
      break;
    case "gate-fail":
      if (!args[0]) throw new Error("gate-fail requires a task id");
      commandGateFail(args[0], args.slice(1).join(" "));
      break;
    case "defer":
      if (!args[0]) throw new Error("defer requires a task id");
      commandDefer(args[0], args.slice(1).join(" "));
      break;
    case "reopen":
      if (!args[0]) throw new Error("reopen requires a task id");
      commandReopen(args[0], args.slice(1).join(" "));
      break;
    case "reset":
      if (!args[0]) throw new Error("reset requires a task id");
      commandReset(args[0], args.slice(1).join(" "));
      break;
    default:
      usage();
      if (command) process.exitCode = 1;
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
