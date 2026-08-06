#!/usr/bin/env bash
# Checkpointed local pi.dev implementation workflow.
#
# Pi implements one bounded task at a time with NVIDIA Nemotron. The orchestrator
# applies only patches that pass independent deterministic gates. Codex reviews the
# cumulative branch at T8 and T15; only an explicit promote updates main.

set -euo pipefail

WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$WORKFLOW_DIR/.." && pwd)"
ORCHESTRATOR="$WORKFLOW_DIR/orchestrator.mjs"
TASKS_FILE="$WORKFLOW_DIR/TASKS.json"
REVIEW_SCHEMA="$WORKFLOW_DIR/review.schema.json"
ARTIFACTS_DIR="$WORKFLOW_DIR/artifacts"
IMPLEMENTATION_WORKTREES="$WORKFLOW_DIR/implementation-worktrees"
GATE_WORKTREES="$WORKFLOW_DIR/gate-worktrees"
CHECKPOINT_WORKTREES="$WORKFLOW_DIR/checkpoint-worktrees"

PI_BIN="${PI_BIN:-pi}"
PI_PROVIDER="${PI_PROVIDER:-nvidia}"
PI_MODEL="${PI_MODEL:-nvidia/nemotron-3-ultra-550b-a55b}"
PI_FALLBACK_ENABLED="${PI_FALLBACK_ENABLED:-1}"
PI_FALLBACK_EXECUTOR="${PI_FALLBACK_EXECUTOR:-gemini-cli}"
GEMINI_CLI_BIN="${GEMINI_CLI_BIN:-gemini}"
GEMINI_CLI_MODEL="${GEMINI_CLI_MODEL:-gemini-2.5-pro}"
PI_FALLBACK_PROVIDER="${PI_FALLBACK_PROVIDER:-google}"
PI_FALLBACK_MODEL="${PI_FALLBACK_MODEL:-$GEMINI_CLI_MODEL}"
PI_THINKING="${PI_THINKING:-}"
PI_TASK_TIMEOUT_SECONDS="${PI_TASK_TIMEOUT_SECONDS:-7200}"
SCOPE_MODE="${SCOPE_MODE:-enforce}"
RUN_BRANCH="${RUN_BRANCH:-workflow/phase-2}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"
MAX_TASK_ATTEMPTS="${MAX_TASK_ATTEMPTS:-3}"

ACTIVE_PROVIDER="$PI_PROVIDER"
ACTIVE_MODEL="$PI_MODEL"
ACTIVE_EXECUTOR="pi"
FALLBACK_READY=0
FALLBACK_USED=0

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
NC=$'\033[0m'

log() { printf '%s[%s]%s %s\n' "$BLUE" "$(date '+%H:%M:%S')" "$NC" "$*"; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s⚠%s %s\n' "$YELLOW" "$NC" "$*"; }
die() { printf '%s✗%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=TERM --kill-after=30s "${seconds}s" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout --signal=TERM --kill-after=30s "${seconds}s" "$@"
  else
    # macOS does not ship GNU timeout. POSIX preserves an alarm across exec,
    # so the replacement pi process receives SIGALRM when the deadline expires.
    perl -e 'alarm shift @ARGV; exec @ARGV or die "exec failed: $!"' "$seconds" "$@"
  fi
}

task_value() {
  local task_id="$1"
  local field="$2"
  jq -r --arg id "$task_id" --arg field "$field" \
    '.[] | select(.id == $id) | .[$field] // empty' "$TASKS_FILE"
}

task_status() {
  task_value "$1" status
}

task_attempt() {
  local value
  value="$(task_value "$1" attempts)"
  printf '%s' "${value:-0}"
}

task_failures() {
  local value
  value="$(task_value "$1" failures)"
  printf '%s' "${value:-0}"
}

task_failure_limit() {
  local value
  value="$(task_value "$1" failure_limit)"
  printf '%s' "${value:-$MAX_TASK_ATTEMPTS}"
}

task_review_failures() {
  local value
  value="$(task_value "$1" review_failures)"
  printf '%s' "${value:-0}"
}

task_review_failure_limit() {
  local value
  value="$(task_value "$1" review_failure_limit)"
  printf '%s' "${value:-$MAX_TASK_ATTEMPTS}"
}

task_title() {
  task_value "$1" title
}

current_task() {
  node "$ORCHESTRATOR" current
}

artifact_dir() {
  local task_id="$1"
  printf '%s/%s/attempt-%s' "$ARTIFACTS_DIR" "$task_id" "$(task_attempt "$task_id")"
}

checkpoint_dir() {
  printf '%s/checkpoints/%s' "$ARTIFACTS_DIR" "$1"
}

working_tree_is_clean() {
  git -C "$REPO_ROOT" diff --quiet &&
    git -C "$REPO_ROOT" diff --cached --quiet &&
    [[ -z "$(git -C "$REPO_ROOT" ls-files --others --exclude-standard)" ]]
}

product_tree_is_clean() {
  [[ -z "$(
    git -C "$REPO_ROOT" status --porcelain -- . \
      ':(exclude).agent-workflow' \
      ':(exclude)node_modules'
  )" ]]
}

assert_product_tree_clean() {
  product_tree_is_clean ||
    die "Product files contain uncommitted changes; refusing to mix them into an agent task."
}

assert_run_branch() {
  local current
  current="$(git -C "$REPO_ROOT" branch --show-current)"
  [[ "$current" == "$RUN_BRANCH" ]] ||
    die "Expected branch '$RUN_BRANCH', found '${current:-detached HEAD}'."
}

prepare_worktree() {
  local path="$1"
  local ref="$2"
  git -C "$REPO_ROOT" worktree remove --force "$path" >/dev/null 2>&1 || true
  [[ ! -e "$path" ]] ||
    die "Stale worktree directory remains at $path; inspect and remove it before retrying."
  git -C "$REPO_ROOT" worktree add --detach "$path" "$ref" >/dev/null
}

remove_worktree() {
  local path="$1"
  git -C "$REPO_ROOT" worktree remove --force "$path" >/dev/null 2>&1 ||
    warn "Could not remove worktree $path; clean it up before the next attempt."
}

cmd_preflight() {
  require_command node
  require_command jq
  require_command git
  require_command codex
  require_command pnpm
  require_command "$PI_BIN"
  if ! command -v timeout >/dev/null 2>&1 &&
    ! command -v gtimeout >/dev/null 2>&1; then
    require_command perl
  fi
  [[ "$MAX_TASK_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] ||
    die "MAX_TASK_ATTEMPTS must be a positive integer."
  [[ "$PI_TASK_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
    die "PI_TASK_TIMEOUT_SECONDS must be a positive integer."
  [[ "$SCOPE_MODE" == "enforce" || "$SCOPE_MODE" == "warn" || "$SCOPE_MODE" == "off" ]] ||
    die "SCOPE_MODE must be enforce, warn, or off."
  [[ "$PI_FALLBACK_ENABLED" == "0" || "$PI_FALLBACK_ENABLED" == "1" ]] ||
    die "PI_FALLBACK_ENABLED must be 0 or 1."
  git check-ref-format --branch "$RUN_BRANCH" >/dev/null
  node "$ORCHESTRATOR" validate
  bash -n "$0"
  ACTIVE_PROVIDER="$PI_PROVIDER"
  ACTIVE_MODEL="$PI_MODEL"
  ACTIVE_EXECUTOR="pi"
  FALLBACK_READY=0
  FALLBACK_USED=0

  local primary_key_available=0
  if provider_key_available "$PI_PROVIDER"; then primary_key_available=1; fi
  if (( primary_key_available == 1 )) && model_available "$PI_PROVIDER" "$PI_MODEL"; then
    :
  elif fallback_available; then
    ACTIVE_PROVIDER="$PI_FALLBACK_PROVIDER"
    ACTIVE_MODEL="$PI_FALLBACK_MODEL"
    ACTIVE_EXECUTOR="$PI_FALLBACK_EXECUTOR"
    FALLBACK_READY=1
    FALLBACK_USED=1
    warn "Primary provider/model unavailable; using configured fallback $ACTIVE_EXECUTOR ($ACTIVE_PROVIDER/$ACTIVE_MODEL)."
  else
    die "Primary provider/model is unavailable and no usable Gemini fallback is configured."
  fi

  if [[ "$PI_FALLBACK_ENABLED" == "1" ]] && fallback_available; then
    FALLBACK_READY=1
  fi
  ok "Local workflow preflight passed for $ACTIVE_MODEL via $ACTIVE_EXECUTOR (provider $ACTIVE_PROVIDER)."
}

provider_key_name() {
  case "$1" in
    nvidia) printf 'NVIDIA_API_KEY' ;;
    google) printf 'GEMINI_API_KEY' ;;
    *) printf '' ;;
  esac
}

provider_key_available() {
  local key_name
  key_name="$(provider_key_name "$1")"
  [[ -n "$key_name" && -n "${!key_name:-}" ]]
}

model_available() {
  local provider="$1"
  local model="$2"
  local model_output
  model_output="$("$PI_BIN" --provider "$provider" --list-models "$model" 2>&1)" || return 1
  printf '%s\n' "$model_output" | grep -F "$model" >/dev/null && return 0
  printf '%s\n' "$model_output" | grep -F "${model#*/}" >/dev/null
}

fallback_available() {
  [[ "$PI_FALLBACK_ENABLED" == "1" ]] || return 1
  [[ "$PI_FALLBACK_PROVIDER" != "$ACTIVE_PROVIDER" ]] || return 1
  case "$PI_FALLBACK_EXECUTOR" in
    gemini-cli)
      command -v "$GEMINI_CLI_BIN" >/dev/null 2>&1
      ;;
    pi)
      provider_key_available "$PI_FALLBACK_PROVIDER" || return 1
      model_available "$PI_FALLBACK_PROVIDER" "$PI_FALLBACK_MODEL"
      ;;
    *)
      return 1
      ;;
  esac
}

cmd_bootstrap() {
  cmd_preflight
  cd "$REPO_ROOT"

  if [[ ! -d .git ]]; then
    git init -b "$MAIN_BRANCH"
    ok "Initialized Git repository on $MAIN_BRANCH."
  fi

  if ! git config user.name >/dev/null; then
    git config user.name "UWBench Orchestrator"
  fi
  if ! git config user.email >/dev/null; then
    git config user.email "orchestrator@uwbench.local"
  fi

  if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    git add .agent-workflow
    git commit -m "chore: seed UWBench agent workflow"
    ok "Created the workflow baseline commit."
  fi

  local current
  current="$(git branch --show-current)"
  if [[ "$current" != "$RUN_BRANCH" ]]; then
    working_tree_is_clean ||
      die "Working tree is not clean; preserve or commit those changes before switching branches."
    if git show-ref --verify --quiet "refs/heads/$RUN_BRANCH"; then
      git switch "$RUN_BRANCH"
    else
      git switch -c "$RUN_BRANCH"
    fi
  fi

  mkdir -p "$ARTIFACTS_DIR"
  jq -n \
    --arg branch "$RUN_BRANCH" \
    --arg mainBranch "$MAIN_BRANCH" \
    --arg baseCommit "$(git rev-parse "$MAIN_BRANCH")" \
    --arg startedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    '{branch:$branch,mainBranch:$mainBranch,baseCommit:$baseCommit,startedAt:$startedAt}' \
    > "$WORKFLOW_DIR/RUN.json"
  ok "Implementation branch ready: $RUN_BRANCH"
}

cmd_next() {
  local requested="${1:-}"
  if [[ -n "$requested" ]]; then
    node "$ORCHESTRATOR" next "$requested"
  else
    node "$ORCHESTRATOR" next
  fi
}

cmd_deploy() {
  local task_id="${1:-$(current_task)}"
  [[ -n "$task_id" ]] || die "No active task. Run '$0 next' first."
  [[ -f "$WORKFLOW_DIR/TASK_${task_id}.md" ]] || die "Missing TASK_${task_id}.md"
  assert_run_branch
  assert_product_tree_clean

  local artifacts
  local baseline_sha
  local worktree
  local task_prompt
  artifacts="$(artifact_dir "$task_id")"
  worktree="$IMPLEMENTATION_WORKTREES/${task_id}-attempt-$(task_attempt "$task_id")"
  task_prompt="$WORKFLOW_DIR/TASK_${task_id}.md"
  mkdir -p "$artifacts" "$IMPLEMENTATION_WORKTREES"
  prepare_worktree "$worktree" HEAD
  baseline_sha="$(git -C "$worktree" rev-parse HEAD)"
  printf '%s\n' "$baseline_sha" > "$artifacts/implementation-baseline.sha"

  local pi_args
  local prompt_content=""
  if [[ "$ACTIVE_EXECUTOR" == "gemini-cli" ]]; then
    prompt_content="$(<"$task_prompt")"
    pi_args=(
      "$GEMINI_CLI_BIN"
      --model "$GEMINI_CLI_MODEL"
      --approval-mode yolo
      --output-format text
      --prompt "$prompt_content"
    )
  else
    pi_args=(
      "$PI_BIN"
      --provider "$ACTIVE_PROVIDER"
      --model "$ACTIVE_MODEL"
      --no-session
      --approve
      -p
    )
    if [[ -n "$PI_THINKING" ]]; then
      pi_args+=(--thinking "$PI_THINKING")
    fi
  fi

  log "Running $ACTIVE_EXECUTOR with $ACTIVE_MODEL for $task_id (timeout: ${PI_TASK_TIMEOUT_SECONDS}s)..."
  jq -nc \
    --arg executor "$ACTIVE_EXECUTOR" \
    --arg provider "$ACTIVE_PROVIDER" \
    --arg model "$ACTIVE_MODEL" \
    --arg task "$task_id" \
    '{executor:$executor,provider:$provider,model:$model,task:$task}' \
    >> "$artifacts/provider-attempts.ndjson"
  local implement_exit=0
  if (
    cd "$worktree"
    if [[ "$ACTIVE_EXECUTOR" == "gemini-cli" ]]; then
      run_with_timeout "$PI_TASK_TIMEOUT_SECONDS" "${pi_args[@]}"
    else
      run_with_timeout "$PI_TASK_TIMEOUT_SECONDS" "${pi_args[@]}" < "$task_prompt"
    fi
  ) > "$artifacts/implement.log" 2>&1; then
    implement_exit=0
  else
    implement_exit=$?
  fi

  git -C "$worktree" add -N . >/dev/null
  git -C "$worktree" \
    diff --binary "$baseline_sha" -- . ':(exclude).agent-workflow' ':(exclude)node_modules' \
    > "$artifacts/implementation.patch"

  {
    printf '## Changes from implementation baseline %s\n' "$baseline_sha"
    git -C "$worktree" \
      diff --name-status "$baseline_sha" -- . ':(exclude).agent-workflow' ':(exclude)node_modules'
    printf '\n## Working tree\n'
    git -C "$worktree" \
      status --short -- . ':(exclude).agent-workflow' ':(exclude)node_modules'
  } > "$artifacts/status.txt"
  remove_worktree "$worktree"

  printf '%s\n' "$implement_exit" > "$artifacts/implement.exit-code"
  if [[ "$implement_exit" -ne 0 ]]; then
    warn "pi exited with status $implement_exit."
    return "$implement_exit"
  fi
  if ! product_tree_is_clean; then
    git -C "$REPO_ROOT" status --short -- . \
      ':(exclude).agent-workflow' \
      ':(exclude)node_modules' > "$artifacts/primary-checkout-leak.status"
    warn "pi modified the primary checkout; preserved its work in place and stopped automatic retries."
    return 76
  fi
  if [[ ! -s "$artifacts/implementation.patch" ]]; then
    if [[ ! -s "$artifacts/implement.log" ]]; then
      warn "pi returned success with no output and no implementation patch."
      return 74
    fi
    warn "pi produced no implementation patch."
    return 1
  fi
  ok "Implementation captured in $artifacts"
}

task_scope_patterns() {
  local task_id="$1"
  jq -r --arg id "$task_id" '
    .[]
    | select(.id == $id)
    | (.files_touched + (.scope_exceptions // []))
    | .[]
  ' "$TASKS_FILE"
}

path_allowed_for_task() {
  local task_id="$1"
  local path="$2"
  local pattern

  # Dependency resolution is a mechanical consequence of package changes.
  [[ "$path" == "pnpm-lock.yaml" ]] && return 0

  while IFS= read -r pattern; do
    [[ -n "$pattern" ]] || continue
    if [[ "$path" == $pattern ]]; then
      return 0
    fi

    # A task that owns a package source file may also update that package's
    # manifest/config and add colocated tests without listing every test path.
    if [[ "$pattern" =~ ^((packages|apps|examples)/[^/]+)/ ]]; then
      local package_root="${BASH_REMATCH[1]}"
      if [[ "$path" == "$package_root/package.json" ||
            "$path" == "$package_root/tsconfig.json" ]]; then
        return 0
      fi
      if [[ "$path" == "$package_root"/src/* ]] &&
        [[ "$path" == *.test.ts ||
           "$path" == *.spec.ts ||
           "$path" == *"/__tests__/"* ]]; then
        return 0
      fi
    fi
  done < <(task_scope_patterns "$task_id")

  return 1
}

write_scope_report() {
  local task_id="$1"
  local worktree="$2"
  local baseline="$3"
  local output="$4"
  local unexpected=0
  local path

  {
    printf 'Task: %s\nMode: %s\n\nChanged paths:\n' "$task_id" "$SCOPE_MODE"
    while IFS= read -r path; do
      [[ -n "$path" ]] || continue
      if path_allowed_for_task "$task_id" "$path"; then
        printf '  ALLOWED     %s\n' "$path"
      else
        printf '  UNEXPECTED  %s\n' "$path"
        unexpected=$((unexpected + 1))
      fi
    done < <(
      git -C "$worktree" diff --name-only "$baseline" -- . ':(exclude).agent-workflow'
    )
    printf '\nUnexpected path count: %s\n' "$unexpected"
  } > "$output"

  if (( unexpected > 0 )); then
    if [[ "$SCOPE_MODE" == "enforce" ]]; then
      return 1
    fi
    if [[ "$SCOPE_MODE" == "warn" ]]; then
      warn "$task_id changed $unexpected path(s) outside its declared scope; see $output"
    fi
  fi
  return 0
}

run_repository_checks() {
  local worktree="$1"
  local output="$2"
  : > "$output"

  if [[ ! -f "$worktree/package.json" ]]; then
    printf 'package.json is missing; project checks cannot run.\n' >> "$output"
    return 1
  fi

  (
    set -uo pipefail
    cd "$worktree"
    if [[ ! -f pnpm-lock.yaml ]]; then
      printf 'pnpm-lock.yaml is missing.\n'
      exit 1
    fi
    pnpm install --frozen-lockfile --ignore-scripts --prefer-offline || exit $?
    for script in lint typecheck test build generate changeset:check smoke; do
      if jq -e --arg script "$script" '.scripts[$script] != null' package.json >/dev/null; then
        printf '\n## pnpm %s\n' "$script"
        pnpm "$script" || exit $?
      fi
    done
  ) >> "$output" 2>&1
}

gate_failure_feedback() {
  local label="$1"
  local log_file="$2"
  {
    printf '%s\n' "$label"
    if [[ -f "$log_file" ]]; then
      printf '\nLast gate output:\n'
      tail -n 60 "$log_file"
    fi
  }
}

record_gate_failure() {
  local task_id="$1"
  local label="$2"
  local log_file="$3"
  local feedback
  feedback="$(gate_failure_feedback "$label" "$log_file")"
  node "$ORCHESTRATOR" gate-fail "$task_id" "$feedback"
}

is_transient_provider_failure() {
  local log_file="$1"
  [[ -f "$log_file" ]] || return 1
  grep -Eqi \
    'ResourceExhausted|worker .*request limit|rate[ -]?limit|HTTP 429|429 status code|status code[^0-9]*429|40[04] status code \(no body\)|instance_id=.*not found for endpoint|temporarily unavailable|service unavailable|overloaded|connection error|request timed out|request timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|Headers Timeout Error' \
    "$log_file"
}

record_provider_deferral() {
  local task_id="$1"
  local log_file="$2"
  local feedback
  feedback="$(
    gate_failure_feedback \
      "Transient model-provider capacity, HTTP 429, or request-timeout failure. Retry this task from its clean baseline without broadening scope." \
      "$log_file"
  )"
  node "$ORCHESTRATOR" defer "$task_id" "$feedback"
}

cmd_gate() {
  local task_id="${1:-$(current_task)}"
  [[ -n "$task_id" ]] || die "No active task to gate."
  [[ "$(task_status "$task_id")" == "in_progress" ]] ||
    die "$task_id is not in_progress."
  assert_run_branch
  assert_product_tree_clean

  local artifacts
  local patch
  local worktree
  local checks
  local scope_report
  local patch_check
  local before_diff
  local after_diff
  artifacts="$(artifact_dir "$task_id")"
  patch="$artifacts/implementation.patch"
  checks="$artifacts/local-gate.log"
  scope_report="$artifacts/scope-report.txt"
  patch_check="$artifacts/patch-check.log"
  before_diff="$artifacts/diff-before-checks.patch"
  after_diff="$artifacts/diff-after-checks.patch"
  worktree="$GATE_WORKTREES/${task_id}-attempt-$(task_attempt "$task_id")"
  [[ -s "$patch" ]] || {
    record_gate_failure "$task_id" "Missing or empty implementation patch." "$artifacts/implement.log"
    return 1
  }

  mkdir -p "$GATE_WORKTREES"
  prepare_worktree "$worktree" HEAD
  if ! git -C "$worktree" apply --check --whitespace=error-all "$patch" \
    > "$patch_check" 2>&1; then
    cat "$patch_check" >&2
    remove_worktree "$worktree"
    record_gate_failure \
      "$task_id" \
      "Patch failed strict application or whitespace validation." \
      "$patch_check"
    return 1
  fi
  git -C "$worktree" apply "$patch"
  git -C "$worktree" add -N . >/dev/null
  git -C "$worktree" diff --binary HEAD -- . ':(exclude).agent-workflow' > "$before_diff"

  if ! write_scope_report "$task_id" "$worktree" HEAD "$scope_report"; then
    remove_worktree "$worktree"
    record_gate_failure "$task_id" "Implementation changed files outside the declared task scope." "$scope_report"
    warn "$task_id failed scope enforcement and was reopened for retry."
    return 1
  fi

  log "Running deterministic gate for $task_id in an isolated worktree..."
  local checks_exit=0
  if run_repository_checks "$worktree" "$checks"; then
    checks_exit=0
  else
    checks_exit=$?
  fi
  printf '%s\n' "$checks_exit" > "$artifacts/local-gate.exit-code"

  git -C "$worktree" add -N . >/dev/null
  git -C "$worktree" diff --binary HEAD -- . ':(exclude).agent-workflow' > "$after_diff"
  if [[ "$checks_exit" -eq 0 ]] && ! cmp -s "$before_diff" "$after_diff"; then
    printf '\nRepository checks changed tracked/generated output. Commit the correct generated state.\n' >> "$checks"
    checks_exit=1
  fi
  remove_worktree "$worktree"

  if [[ "$checks_exit" -ne 0 ]]; then
    record_gate_failure "$task_id" "Automated deterministic gate failed." "$checks"
    warn "$task_id failed its gate and was reopened for retry."
    return 1
  fi

  git -C "$REPO_ROOT" apply --check "$patch" ||
    die "Validated patch no longer applies to the implementation branch."
  git -C "$REPO_ROOT" apply "$patch"
  node "$ORCHESTRATOR" gate-pass "$task_id"

  # A new checkpoint task implementation invalidates any earlier checkpoint
  # verdict for that task.
  if [[ "$task_id" == "T8" || "$task_id" == "T15" ]]; then
    rm -f "$(checkpoint_dir "$task_id")/review.json" "$(checkpoint_dir "$task_id")/metadata.json"
  fi

  git -C "$REPO_ROOT" add -A
  git -C "$REPO_ROOT" commit -m "uwbench: $task_id - $(task_title "$task_id")"
  ok "$task_id passed its gate and was committed."
}

checkpoint_is_passed() {
  local target="$1"
  local review_json
  local metadata_json
  review_json="$(checkpoint_dir "$target")/review.json"
  metadata_json="$(checkpoint_dir "$target")/metadata.json"
  [[ -f "$review_json" ]] &&
    [[ -f "$metadata_json" ]] &&
    [[ "$(jq -r '.verdict // empty' "$review_json")" == "PASS" ]] &&
    [[ "$(jq -r '.verdict // empty' "$metadata_json")" == "PASS" ]] ||
    return 1

  # T8 remains a valid historical checkpoint while later tasks add commits.
  # T15 is the promotion boundary and must match the current branch exactly.
  if [[ "$target" == "T15" ]]; then
    [[ "$(jq -r '.headSha // empty' "$metadata_json")" == "$(git -C "$REPO_ROOT" rev-parse HEAD)" ]]
  fi
}

checkpoint_incomplete_tasks() {
  local target="$1"
  local target_priority
  target_priority="$(task_value "$target" priority)"
  jq -r --argjson priority "$target_priority" '
    sort_by(.priority)
    | map(select(.priority <= $priority and .status != "gated_pass") | .id)
    | join(",")
  ' "$TASKS_FILE"
}

write_checkpoint_scope() {
  local target="$1"
  local output="$2"
  local target_priority
  target_priority="$(task_value "$target" priority)"
  jq -r --argjson priority "$target_priority" '
    sort_by(.priority)
    | .[]
    | select(.priority <= $priority)
    | "## \(.id): \(.title)\n" +
      (.acceptance | map("- " + .) | join("\n")) + "\n"
  ' "$TASKS_FILE" > "$output"
}

cmd_checkpoint() {
  local target="$1"
  [[ "$target" == "T8" || "$target" == "T15" ]] ||
    die "Checkpoint must be T8 or T15."
  [[ -z "$(checkpoint_incomplete_tasks "$target")" ]] ||
    die "Checkpoint $target still has incomplete tasks: $(checkpoint_incomplete_tasks "$target")."
  assert_run_branch

  if checkpoint_is_passed "$target"; then
    ok "$target checkpoint already passed."
    return 0
  fi

  local artifacts
  local worktree
  local checks
  local scope
  local review_json
  local review_log
  artifacts="$(checkpoint_dir "$target")"
  worktree="$CHECKPOINT_WORKTREES/$target"
  checks="$artifacts/checkpoint-checks.log"
  scope="$artifacts/scope.md"
  review_json="$artifacts/review.json"
  review_log="$artifacts/codex-review.log"
  mkdir -p "$artifacts" "$CHECKPOINT_WORKTREES"
  write_checkpoint_scope "$target" "$scope"

  prepare_worktree "$worktree" HEAD
  log "Re-running the complete repository gate for checkpoint $target..."
  local checks_exit=0
  if run_repository_checks "$worktree" "$checks"; then
    checks_exit=0
  else
    checks_exit=$?
  fi
  printf '%s\n' "$checks_exit" > "$artifacts/checkpoint-checks.exit-code"
  if [[ "$checks_exit" -eq 0 ]] &&
    [[ -n "$(git -C "$worktree" status --porcelain -- . ':(exclude).agent-workflow')" ]]; then
    printf '\nRepository checks left tracked or untracked output behind.\n' >> "$checks"
    checks_exit=1
  fi

  if [[ "$checks_exit" -ne 0 ]]; then
    remove_worktree "$worktree"
    local feedback
    feedback="$(gate_failure_feedback "Checkpoint $target repository gate failed." "$checks")"
    node "$ORCHESTRATOR" reopen "$target" "$feedback"
    warn "$target was reopened from failed checkpoint checks."
    return 1
  fi

  log "Running cumulative Codex review for checkpoint $target..."
  local review_exit=0
  if codex exec \
    -C "$worktree" \
    --add-dir "$WORKFLOW_DIR" \
    --add-dir "$artifacts" \
    --sandbox read-only \
    --ephemeral \
    --output-schema "$REVIEW_SCHEMA" \
    --output-last-message "$review_json" \
    - > "$review_log" 2>&1 <<EOF
Review UWBench checkpoint $target as a strict architecture and integration reviewer.

This is a cumulative checkpoint review, not a per-task patch review.
Read:
- $WORKFLOW_DIR/SPEC.md
- $WORKFLOW_DIR/PLAN.md
- $scope
- $checks

Inspect the actual repository at HEAD and the cumulative diff from:
$(git -C "$REPO_ROOT" rev-parse "$MAIN_BRANCH")
to:
$(git -C "$REPO_ROOT" rev-parse HEAD)

For T8, focus on protocol cohesion, schema ownership, generated-artifact drift,
compatibility, and whether T1-T8 form a stable foundation.
For T15, run a whole-system review of the executable vertical slice, including
protocol conformance, case privacy, tool budgets, event integrity, cancellation,
CLI behavior, and the smoke path.

Do not modify files. Treat failed or unverified required checks as not met.
Return only the JSON object required by the supplied output schema.
EOF
  then
    review_exit=0
  else
    review_exit=$?
  fi
  remove_worktree "$worktree"

  if [[ "$review_exit" -ne 0 ]]; then
    warn "Codex checkpoint command failed with status $review_exit. See $review_log"
    return 2
  fi

  jq . "$review_json"
  local verdict
  verdict="$(jq -r '.verdict' "$review_json")"
  jq -n \
    --arg checkpoint "$target" \
    --arg verdict "$verdict" \
    --arg headSha "$(git -C "$REPO_ROOT" rev-parse HEAD)" \
    --arg reviewedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    '{checkpoint:$checkpoint,verdict:$verdict,headSha:$headSha,reviewedAt:$reviewedAt}' \
    > "$artifacts/metadata.json"

  if [[ "$verdict" == "PASS" ]]; then
    ok "Cumulative checkpoint $target passed."
    return 0
  fi

  local feedback
  feedback="$(
    jq -r --arg target "$target" '
      "Checkpoint " + $target + " review failed: " + .summary + "\nRequired changes:\n" +
      (.requiredChanges | map("- " + .) | join("\n"))
    ' "$review_json"
  )"
  node "$ORCHESTRATOR" reopen "$target" "$feedback"
  warn "$target was reopened with Codex checkpoint feedback."
  return 1
}

run_active_task() {
  local task_id="$1"
  local artifacts
  artifacts="$(artifact_dir "$task_id")"

  local deploy_exit=0
  if cmd_deploy "$task_id"; then
    deploy_exit=0
  else
    deploy_exit=$?
  fi
  if [[ "$deploy_exit" -ne 0 ]]; then
    if {
      [[ "$deploy_exit" -eq 74 ]] || is_transient_provider_failure "$artifacts/implement.log"
    } && (( FALLBACK_READY == 1 && FALLBACK_USED == 0 )); then
      cp "$artifacts/implement.log" "$artifacts/implement.primary.log"
      ACTIVE_PROVIDER="$PI_FALLBACK_PROVIDER"
      ACTIVE_MODEL="$PI_FALLBACK_MODEL"
      ACTIVE_EXECUTOR="$PI_FALLBACK_EXECUTOR"
      FALLBACK_USED=1
      jq -n \
        --arg fromExecutor "pi" \
        --arg fromProvider "$PI_PROVIDER" \
        --arg fromModel "$PI_MODEL" \
        --arg toExecutor "$ACTIVE_EXECUTOR" \
        --arg toProvider "$ACTIVE_PROVIDER" \
        --arg toModel "$ACTIVE_MODEL" \
        --arg reason "transient provider capacity or empty response" \
        '{fromExecutor:$fromExecutor,fromProvider:$fromProvider,fromModel:$fromModel,toExecutor:$toExecutor,toProvider:$toProvider,toModel:$toModel,reason:$reason}' \
        > "$artifacts/provider-fallback.json"
      warn "$task_id encountered $PI_PROVIDER capacity; retrying once with $ACTIVE_EXECUTOR ($ACTIVE_PROVIDER/$ACTIVE_MODEL)."
      if cmd_deploy "$task_id"; then
        deploy_exit=0
      else
        deploy_exit=$?
      fi
    fi
  fi
  if [[ "$deploy_exit" -ne 0 ]]; then
    if [[ "$deploy_exit" -eq 76 ]]; then
      record_gate_failure \
        "$task_id" \
        "pi modified the primary checkout instead of its isolated worktree. Preserve or clean the files listed in primary-checkout-leak.status before resuming." \
        "$artifacts/primary-checkout-leak.status"
      warn "Stopped $task_id because pi escaped its isolated worktree."
      return 76
    fi
    if [[ "$deploy_exit" -eq 74 ]]; then
      record_provider_deferral "$task_id" "$artifacts/implement.log"
      warn "Deferred $task_id because pi returned an empty provider response."
      return 75
    fi
    if is_transient_provider_failure "$artifacts/implement.log"; then
      record_provider_deferral "$task_id" "$artifacts/implement.log"
      warn "Deferred $task_id because the model provider is temporarily saturated."
      return 75
    fi
    if [[ "$deploy_exit" -eq 124 || "$deploy_exit" -eq 142 ]]; then
      record_gate_failure \
        "$task_id" \
        "pi/Nemotron exceeded the ${PI_TASK_TIMEOUT_SECONDS}s task deadline. Retry from the clean task baseline and keep the implementation bounded to the declared scope." \
        "$artifacts/implement.log"
      warn "Stopped $task_id after the pi task deadline."
      return 1
    fi
    record_gate_failure \
      "$task_id" \
      "pi/Nemotron execution failed with status $deploy_exit." \
      "$artifacts/implement.log"
    return 1
  fi

  local gate_exit=0
  if cmd_gate "$task_id"; then
    gate_exit=0
  else
    gate_exit=$?
  fi
  return "$gate_exit"
}

run_to_checkpoint() {
  local target="$1"
  local target_priority
  target_priority="$(task_value "$target" priority)"

  while true; do
    while [[ -n "$(checkpoint_incomplete_tasks "$target")" ]]; do
      local task_id
      task_id="$(current_task)"
      if [[ -z "$task_id" ]]; then
        cmd_next
        task_id="$(current_task)"
      fi
      [[ -n "$task_id" ]] || die "No task is ready before checkpoint $target."

      local task_priority
      task_priority="$(task_value "$task_id" priority)"
      (( task_priority <= target_priority )) ||
        die "Reached $task_id before checkpoint target $target was complete."
      local failure_limit
      failure_limit="$(task_failure_limit "$task_id")"
      (( $(task_failures "$task_id") < failure_limit )) ||
        die "$task_id reached its implementation failure limit of $failure_limit."

      local task_exit=0
      if run_active_task "$task_id"; then
        task_exit=0
      else
        task_exit=$?
      fi
      if [[ "$task_exit" -eq 75 ]]; then
        die "$task_id was deferred because NVIDIA capacity is unavailable. Resume with run-all later."
      fi
      if [[ "$task_exit" -eq 76 ]]; then
        die "$task_id modified the primary checkout. Inspect $(artifact_dir "$task_id")/primary-checkout-leak.status before resuming."
      fi
      if [[ "$task_exit" -ne 0 ]]; then
        if (( $(task_failures "$task_id") >= failure_limit )); then
          die "$task_id failed its implementation gate $(task_failures "$task_id") times. Inspect $(artifact_dir "$task_id")."
        fi
        warn "Retrying $task_id with gate feedback."
      fi
    done

    local checkpoint_exit=0
    if cmd_checkpoint "$target"; then
      checkpoint_exit=0
    else
      checkpoint_exit=$?
    fi
    if [[ "$checkpoint_exit" -eq 0 ]]; then
      return 0
    fi
    if [[ "$checkpoint_exit" -eq 2 ]]; then
      die "Checkpoint reviewer could not complete; inspect $(checkpoint_dir "$target")."
    fi
    local review_failure_limit
    review_failure_limit="$(task_review_failure_limit "$target")"
    if (( $(task_review_failures "$target") >= review_failure_limit )); then
      die "$target failed checkpoint review $(task_review_failures "$target") times (limit: $review_failure_limit)."
    fi
    warn "Retrying $target with cumulative checkpoint feedback."
  done
}

run_all_tasks() {
  while [[ -n "$(jq -r '.[] | select(.status != "gated_pass") | .id' "$TASKS_FILE")" ]]; do
    local task_id
    task_id="$(current_task)"
    if [[ -z "$task_id" ]]; then
      cmd_next
      task_id="$(current_task)"
    fi
    [[ -n "$task_id" ]] || die "No task is ready in the active phase."

    local failure_limit
    failure_limit="$(task_failure_limit "$task_id")"
    (( $(task_failures "$task_id") < failure_limit )) ||
      die "$task_id reached its implementation failure limit of $failure_limit."

    local task_exit=0
    if run_active_task "$task_id"; then
      task_exit=0
    else
      task_exit=$?
    fi
    if [[ "$task_exit" -eq 75 ]]; then
      die "$task_id was deferred because NVIDIA capacity is unavailable. Resume with run-all later."
    fi
    if [[ "$task_exit" -eq 76 ]]; then
      die "$task_id modified the primary checkout. Inspect $(artifact_dir "$task_id")/primary-checkout-leak.status before resuming."
    fi
    if [[ "$task_exit" -ne 0 ]]; then
      if (( $(task_failures "$task_id") >= failure_limit )); then
        die "$task_id failed its implementation gate $(task_failures "$task_id") times. Inspect $(artifact_dir "$task_id")."
      fi
      warn "Retrying $task_id with gate feedback."
    fi
  done
}

cmd_run_all() {
  cmd_bootstrap
  if jq -e 'any(.[]; .id == "T16")' "$TASKS_FILE" >/dev/null; then
    run_all_tasks
    ok "Phase 2 implementation tasks passed on $RUN_BRANCH."
    return 0
  fi
  run_to_checkpoint T8
  run_to_checkpoint T15
  ok "Phase 0-1 implementation and both reviews passed on $RUN_BRANCH."
  printf '\nHuman promotion is intentionally separate:\n  %s promote\n' "$0"
}

cmd_run_one() {
  cmd_bootstrap
  local task_id
  task_id="$(current_task)"
  if [[ -z "$task_id" ]]; then
    cmd_next "${1:-}"
    task_id="$(current_task)"
  fi
  run_active_task "$task_id"
}

cmd_promote() {
  cmd_preflight
  assert_run_branch
  [[ "$(task_status T15)" == "gated_pass" ]] || die "T15 is not complete."
  checkpoint_is_passed T15 || die "The final T15 checkpoint has not passed."

  local reviewed_head
  reviewed_head="$(jq -r '.headSha // empty' "$(checkpoint_dir T15)/metadata.json")"
  [[ "$reviewed_head" == "$(git -C "$REPO_ROOT" rev-parse HEAD)" ]] ||
    die "The branch changed after final review; rerun checkpoint T15."
  working_tree_is_clean || die "Working tree is not clean; promotion stopped."

  git -C "$REPO_ROOT" switch "$MAIN_BRANCH"
  git -C "$REPO_ROOT" merge --ff-only "$RUN_BRANCH"
  ok "Promoted reviewed branch $RUN_BRANCH to $MAIN_BRANCH."
}

cmd_status() {
  node "$ORCHESTRATOR" status
  if [[ -d "$REPO_ROOT/.git" ]]; then
    printf '\nBranch: %s\n' "$(git -C "$REPO_ROOT" branch --show-current)"
    for checkpoint in T8 T15; do
      if checkpoint_is_passed "$checkpoint"; then
        printf 'Checkpoint %s: PASS\n' "$checkpoint"
      else
        printf 'Checkpoint %s: pending\n' "$checkpoint"
      fi
    done
  fi
}

usage() {
  cat <<EOF
Usage: .agent-workflow/orchestrator.sh <command> [args]

Primary commands:
  preflight                  Validate pi, its selected model, and local tools
  run-all                    Run the active phase manifest to its configured checkpoint or completion
  status                     Show tasks, branch, and checkpoint status
  promote                    Fast-forward main after the final human decision

Diagnostic/manual commands:
  bootstrap                  Initialize Git and switch to the run branch
  next [task-id]             Generate the next task prompt
  deploy [task-id]           Run pi/Nemotron in an isolated worktree
  gate [task-id]             Independently test, apply, and commit a patch
  checkpoint <T8|T15>        Run a cumulative Codex review
  run-one [task-id]          Bootstrap, deploy, and gate one task

Environment:
  PI_BIN=$PI_BIN
  PI_PROVIDER=$PI_PROVIDER
  PI_MODEL=$PI_MODEL
  PI_FALLBACK_ENABLED=$PI_FALLBACK_ENABLED
  PI_FALLBACK_EXECUTOR=$PI_FALLBACK_EXECUTOR
  GEMINI_CLI_BIN=$GEMINI_CLI_BIN
  GEMINI_CLI_MODEL=$GEMINI_CLI_MODEL
  PI_FALLBACK_PROVIDER=$PI_FALLBACK_PROVIDER
  PI_FALLBACK_MODEL=$PI_FALLBACK_MODEL
  PI_THINKING=${PI_THINKING:-<model default>}
  PI_TASK_TIMEOUT_SECONDS=$PI_TASK_TIMEOUT_SECONDS
  RUN_BRANCH=$RUN_BRANCH
  MAIN_BRANCH=$MAIN_BRANCH
  MAX_TASK_ATTEMPTS=$MAX_TASK_ATTEMPTS
  SCOPE_MODE=$SCOPE_MODE
EOF
}

case "${1:-status}" in
  preflight) cmd_preflight ;;
  bootstrap) cmd_bootstrap ;;
  status) cmd_status ;;
  next) cmd_next "${2:-}" ;;
  deploy) cmd_deploy "${2:-}" ;;
  gate) cmd_gate "${2:-}" ;;
  checkpoint)
    [[ -n "${2:-}" ]] || die "checkpoint requires T8 or T15."
    cmd_checkpoint "$2"
    ;;
  run-one) cmd_run_one "${2:-}" ;;
  run-all) cmd_run_all ;;
  promote) cmd_promote ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
