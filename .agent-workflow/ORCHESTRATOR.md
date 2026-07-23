# UWBench checkpointed implementation workflow

## Operating model

- **Local orchestrator:** owns task order, independent gates, commits, checkpoint reviews, and promotion.
- **pi.dev + NVIDIA Nemotron:** implements one bounded task in a clean, attempt-specific Git worktree.
- **Codex:** reviews the cumulative implementation only at the two architectural checkpoints.
- **Human:** decides whether to promote the final reviewed branch to `main`.

The workflow never requests or stores chain-of-thought.

## Why review is checkpointed

Reviewing every small task adds latency and encourages local judgments before the
architecture is visible. Deferring all review until the end lets foundational
protocol errors propagate too far. UWBench therefore uses:

```text
T1 → … → T8  ── deterministic gate per task ── Codex protocol checkpoint
T9 → … → T15 ── deterministic gate per task ── Codex end-to-end checkpoint
                                                   ↓
                                           explicit human promotion
```

Deterministic gates run after every task. They install from the lockfile, execute
every available root `lint`, `typecheck`, `test`, `build`, `generate`, and
`smoke` script, and reject checks that mutate generated/tracked output.

If a gate fails, the task is automatically returned to `pending` with the end of
the failing log in its next prompt. If a checkpoint fails, T8 or T15 is reopened
with Codex's required changes. Retries stop at `MAX_TASK_ATTEMPTS` rather than
looping indefinitely.

## Branch and commit policy

`bootstrap` creates the initial workflow commit on `main`, then creates or
resumes `workflow/phase-1`. A successful deterministic gate applies and commits
that task's patch on the run branch. `main` remains unchanged throughout the
implementation run.

Only this explicit command promotes the final result:

```bash
bash .agent-workflow/orchestrator.sh promote
```

Promotion requires:

- every task through T15 has status `gated_pass`;
- the T15 cumulative review is `PASS`;
- the reviewed commit is still `HEAD`;
- the working tree is clean; and
- `main` can be fast-forwarded without rewriting history.

## First run

From `/Users/tobias/Development/uwbench`:

```bash
bash .agent-workflow/orchestrator.sh preflight
bash .agent-workflow/orchestrator.sh run-all
```

The public repository should be an empty organization-owned repository at
`SecureLend/uwbench`. After `bootstrap`, connect and publish the two branches:

```bash
git remote add origin git@github.com:SecureLend/uwbench.git
git push -u origin main
git push -u origin workflow/phase-1
```

Do not initialize the GitHub repository with a README, license, or `.gitignore`;
T1 owns those files. Certification cases and expected hidden outputs must never
be pushed to the public repository.

`run-all` is resumable. It executes:

1. Git bootstrap and run-branch selection.
2. T1 through T8 with one isolated deterministic gate per task.
3. The cumulative T8 protocol/schema review.
4. T9 through T15 with one isolated deterministic gate per task.
5. The cumulative T15 vertical-slice review.
6. A stop before promotion for human inspection.

After inspecting the final review and branch:

```bash
bash .agent-workflow/orchestrator.sh promote
```

## Configuration

Defaults:

```bash
export NVIDIA_API_KEY=nvapi-your-key
export PI_BIN=pi
export PI_PROVIDER=nvidia
export PI_MODEL=nvidia/nemotron-3-ultra-550b-a55b
# Optional: leave empty to use the model/extension default.
export PI_THINKING=
export RUN_BRANCH=workflow/phase-1
export MAIN_BRANCH=main
export MAX_TASK_ATTEMPTS=3
```

Override these in the shell before starting the run.

`pi` runs locally in print mode with `--no-session --approve`, the explicit
provider/model above, and its normal coding tools. `NVIDIA_API_KEY` must be
present in the shell that launches the orchestrator. The workflow intentionally
never passes it as a CLI argument or writes it into the repository or artifacts.

## Safety properties

- At most one task may be `in_progress`.
- A task is eligible only after every dependency is `gated_pass`.
- Every pi attempt uses an isolated `implementation-worktrees/<task>-attempt-<n>` worktree.
- Implementation diffs are anchored to a recorded pre-agent commit, so they capture
  untracked, binary, uncommitted, and accidentally committed changes.
- Workflow state, logs, dependencies, and worktrees are excluded from patches.
- A task patch is tested in a disposable worktree before it touches the run branch.
- Checks that modify the candidate patch fail the gate.
- Only gated patches are committed.
- Checkpoint feedback is bounded by the same retry limit as task feedback.
- A final review is invalidated when the reviewed branch changes.
- `promote` uses a fast-forward merge and never rewrites `main`.

## Commands

Primary:

```bash
bash .agent-workflow/orchestrator.sh status
bash .agent-workflow/orchestrator.sh run-all
bash .agent-workflow/orchestrator.sh promote
```

Diagnostic or manual recovery:

```bash
bash .agent-workflow/orchestrator.sh bootstrap
bash .agent-workflow/orchestrator.sh next
bash .agent-workflow/orchestrator.sh deploy T1
bash .agent-workflow/orchestrator.sh gate T1
bash .agent-workflow/orchestrator.sh checkpoint T8
bash .agent-workflow/orchestrator.sh run-one T1
```

The dependency-free state machine can be inspected directly:

```bash
node .agent-workflow/orchestrator.mjs validate
node .agent-workflow/orchestrator.mjs status
node .agent-workflow/orchestrator.mjs current
```

## Artifacts

Task artifacts:

```text
.agent-workflow/artifacts/T1/attempt-1/
├── implement.log
├── implement.exit-code
├── implementation.patch
├── implementation-baseline.sha
├── status.txt
├── local-gate.log
├── local-gate.exit-code
├── diff-before-checks.patch
└── diff-after-checks.patch
```

Checkpoint artifacts:

```text
.agent-workflow/artifacts/checkpoints/T8/
├── scope.md
├── checkpoint-checks.log
├── checkpoint-checks.exit-code
├── codex-review.log
├── review.json
└── metadata.json
```

`review.json` conforms to `review.schema.json`. `metadata.json` binds the verdict
to a commit hash.

## Recovery

The normal recovery action is simply:

```bash
bash .agent-workflow/orchestrator.sh run-all
```

The command resumes pending work and reuses passed checkpoints.

If a task was marked `in_progress` but never deployed:

```bash
node .agent-workflow/orchestrator.mjs reset T1 "Task was not deployed"
```

If the process stops after the retry limit, inspect the matching attempt
directory. Increase `MAX_TASK_ATTEMPTS` only after understanding the repeated
failure.

If Codex itself cannot execute, the checkpoint is not treated as a failed
implementation and the task is not reopened. Fix the local Codex invocation and
resume `run-all`.

## Task graph

`TASKS.json` is authoritative. `PLAN.md` is its human-readable summary.

```text
T1
├── T2
├── T3
└── T4
    ├── T5 ──┐
    ├── T6   │
    └── T7 ──┼── T8  ← protocol checkpoint
             ├── T9
             └── T10 ── T12 ── T13 ──┐
                 T6,T9,T10,T12,T13 ── T11 ── T14 ── T15
                                                        ↑
                                              end-to-end checkpoint
```
