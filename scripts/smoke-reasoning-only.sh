#!/usr/bin/env bash
# Smoke test for Phase 1 reasoning-only vertical slice
# Starts deterministic baseline, runs case-00001, verifies outputs, stops baseline

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[FAIL]${NC} $*"; }

# Configuration
BASELINE_PORT=9090
BASELINE_URL="http://localhost:${BASELINE_PORT}"
CASE_PATH="benchmark/commercial-credit-v0.1/public-cases/case-00001"
RUN_ID="smoke_$(date +%s)"
TIMEOUT_SECONDS=120

# Paths
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# Cleanup function
cleanup() {
  log_info "Cleaning up..."
  if [[ -n "${BASELINE_PID:-}" ]]; then
    kill "${BASELINE_PID}" 2>/dev/null || true
    # Wait for process to terminate
    for i in {1..10}; do
      if ! kill -0 "${BASELINE_PID}" 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    # Force kill if still running
    if kill -0 "${BASELINE_PID}" 2>/dev/null; then
      kill -9 "${BASELINE_PID}" 2>/dev/null || true
    fi
    wait "${BASELINE_PID}" 2>/dev/null || true
    log_info "Baseline stopped (PID: ${BASELINE_PID})"
  fi
}

# Ensure port is free before starting
free_port() {
  if lsof -ti:"${BASELINE_PORT}" >/dev/null 2>&1; then
    log_warn "Port ${BASELINE_PORT} is in use, freeing..."
    lsof -ti:"${BASELINE_PORT}" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

trap cleanup EXIT INT TERM

log_info "========================================"
log_info "UWBench Phase 1 Smoke Test"
log_info "========================================"
log_info "Case: ${CASE_PATH}"
log_info "Agent: ${BASELINE_URL}"
log_info "Run ID: ${RUN_ID}"
log_info ""

# Step 0: Ensure port is free
free_port

# Step 1: Validate case
log_info "Step 1: Validating case structure..."
if ! node apps/cli/dist/index.js validate-case "${CASE_PATH}" --json > /tmp/validate-output.json 2>&1; then
  log_error "Case validation failed"
  cat /tmp/validate-output.json
  exit 1
fi
log_success "Case validation passed"

# Step 2: Start deterministic baseline
log_info "Step 2: Starting deterministic baseline on port ${BASELINE_PORT}..."
PORT="${BASELINE_PORT}" BEHAVIOR=complete pnpm --filter @uwbench/deterministic-baseline start &
BASELINE_PID=$!

# Wait for baseline to be ready
log_info "Waiting for baseline health check..."
for i in {1..30}; do
  if curl -sf "${BASELINE_URL}/health" > /dev/null 2>&1; then
    log_success "Baseline is healthy (PID: ${BASELINE_PID})"
    break
  fi
  if ! kill -0 "${BASELINE_PID}" 2>/dev/null; then
    log_error "Baseline process died"
    exit 1
  fi
  sleep 1
done

if ! curl -sf "${BASELINE_URL}/health" > /dev/null 2>&1; then
  log_error "Baseline health check timeout"
  exit 1
fi

# Step 3: Run case-00001
log_info "Step 3: Running case-00001 against baseline..."
RUN_OUTPUT=$(mktemp)

# Run command with portable timeout (macOS doesn't have 'timeout' command)
RUN_CMD=(node apps/cli/dist/index.js run
  --case "${CASE_PATH}"
  --agent "${BASELINE_URL}"
  --run-id "${RUN_ID}"
  --json)

"${RUN_CMD[@]}" > "${RUN_OUTPUT}" 2>&1 &
RUN_PID=$!

# Wait for completion with timeout
ELAPSED=0
while kill -0 "${RUN_PID}" 2>/dev/null; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
  if [[ ${ELAPSED} -ge ${TIMEOUT_SECONDS} ]]; then
    log_error "Run command timeout after ${TIMEOUT_SECONDS} seconds"
    kill "${RUN_PID}" 2>/dev/null || true
    exit 1
  fi
done
wait "${RUN_PID}"
RUN_EXIT_CODE=$?
if [[ ${RUN_EXIT_CODE} -ne 0 ]]; then
  log_error "Run command failed"
  cat "${RUN_OUTPUT}"
  exit 1
fi

log_success "Run completed"
RUN_RESULT=$(cat "${RUN_OUTPUT}")
echo "${RUN_RESULT}" | jq .

# Extract run directory
RUN_DIR=$(echo "${RUN_RESULT}" | jq -r '.runDir')
RUN_STATUS=$(echo "${RUN_RESULT}" | jq -r '.status')

if [[ "${RUN_STATUS}" != "completed" ]]; then
  log_error "Run status: ${RUN_STATUS}"
  exit 1
fi

log_info "Run directory: ${RUN_DIR}"

# Step 4: Verify output files exist
log_info "Step 4: Verifying output files..."
REQUIRED_FILES=(
  "run-manifest.json"
  "events.ndjson"
  "submission.json"
  "checksums.json"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "${RUN_DIR}/${file}" ]]; then
    log_error "Missing required file: ${file}"
    exit 1
  fi
  log_success "Found: ${file}"
done

# Step 5: Verify run manifest
log_info "Step 5: Verifying run manifest..."
MANIFEST=$(cat "${RUN_DIR}/run-manifest.json")
echo "${MANIFEST}" | jq .

MANIFEST_STATUS=$(echo "${MANIFEST}" | jq -r '.status')
if [[ "${MANIFEST_STATUS}" != "completed" ]]; then
  log_error "Manifest status: ${MANIFEST_STATUS}"
  exit 1
fi

MANIFEST_CASE_ID=$(echo "${MANIFEST}" | jq -r '.caseId')
if [[ "${MANIFEST_CASE_ID}" != "case-00001" ]]; then
  log_error "Manifest caseId mismatch: ${MANIFEST_CASE_ID}"
  exit 1
fi

log_success "Run manifest valid"

# Step 6: Verify event hash chain
log_info "Step 6: Verifying event hash chain..."
EVENT_COUNT=$(wc -l < "${RUN_DIR}/events.ndjson")
log_info "Event count: ${EVENT_COUNT}"

# Verify each event has required fields and hash chain
FIRST_HASH="sha256:genesis"
PREV_HASH="${FIRST_HASH}"
SEQ=0

while IFS= read -r line; do
  SEQ=$((SEQ + 1))
  EVENT_ID=$(echo "${line}" | jq -r '.eventId')
  EVENT_SEQ=$(echo "${line}" | jq -r '.sequence')
  EVENT_PREV_HASH=$(echo "${line}" | jq -r '.previousHash')
  EVENT_HASH=$(echo "${line}" | jq -r '.hash')
  EVENT_TYPE=$(echo "${line}" | jq -r '.type')
  EVENT_SOURCE=$(echo "${line}" | jq -r '.source')

  if [[ "${EVENT_SEQ}" != "${SEQ}" ]]; then
    log_error "Sequence mismatch at event ${SEQ}: expected ${SEQ}, got ${EVENT_SEQ}"
    exit 1
  fi

  if [[ "${EVENT_PREV_HASH}" != "${PREV_HASH}" ]]; then
    log_error "Previous hash mismatch at event ${SEQ}"
    exit 1
  fi

  # Verify current hash
  # We can't easily recompute JCS hash in bash, but we verify structure
  if [[ -z "${EVENT_HASH}" || "${EVENT_HASH}" == "null" ]]; then
    log_error "Missing hash at event ${SEQ}"
    exit 1
  fi

  PREV_HASH="${EVENT_HASH}"
  log_info "  Event ${SEQ}: ${EVENT_TYPE} (${EVENT_SOURCE}) - hash: ${EVENT_HASH:0:16}..."
done < "${RUN_DIR}/events.ndjson"

if ! node --input-type=module - "${RUN_DIR}/events.ndjson" <<'NODE'
import { readFileSync } from "node:fs";
import { verifyChain } from "./packages/protocol/dist/events.js";

const eventsPath = process.argv[2];
const events = readFileSync(eventsPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (!verifyChain(events)) {
  process.exitCode = 1;
}
NODE
then
  log_error "Event hash chain failed cryptographic verification"
  exit 1
fi

log_success "Event hash chain cryptographically verified (${SEQ} events)"

# Step 7: Verify checksums
log_info "Step 7: Verifying checksums..."
CHECKSUMS=$(cat "${RUN_DIR}/checksums.json")
echo "${CHECKSUMS}" | jq .

CHECKSUM_FILES=$(echo "${CHECKSUMS}" | jq -r '.files | keys[]')
for file in ${CHECKSUM_FILES}; do
  EXPECTED_HASH=$(echo "${CHECKSUMS}" | jq -r ".files[\"${file}\"]")
  if [[ -f "${RUN_DIR}/${file}" ]]; then
    ACTUAL_HASH="sha256:$(sha256sum "${RUN_DIR}/${file}" | cut -d' ' -f1)"
    if [[ "${ACTUAL_HASH}" != "${EXPECTED_HASH}" ]]; then
      log_error "Checksum mismatch for ${file}"
      log_error "  Expected: ${EXPECTED_HASH}"
      log_error "  Actual:   ${ACTUAL_HASH}"
      exit 1
    fi
    log_success "Checksum verified: ${file}"
  else
    log_warn "File in checksums but not found: ${file}"
  fi
done

# Step 8: Verify submission.json schema
log_info "Step 8: Verifying submission.json structure..."
SUBMISSION=$(cat "${RUN_DIR}/submission.json")
echo "${SUBMISSION}" | jq .

# Check required fields per UnderwritingSubmission schema
REQUIRED_SUBMISSION_FIELDS=(
  "schemaVersion"
  "financialSpread"
  "normalizedFacts"
  "risks"
  "discrepancies"
  "complianceFindings"
  "followUpRequests"
  "policyAssessment"
  "recommendation"
  "memo"
  "confidence"
)

for field in "${REQUIRED_SUBMISSION_FIELDS[@]}"; do
  if ! echo "${SUBMISSION}" | jq -e ".${field}" > /dev/null; then
    log_error "Missing required submission field: ${field}"
    exit 1
  fi
done

# Verify schemaVersion
SUB_SCHEMA_VERSION=$(echo "${SUBMISSION}" | jq -r '.schemaVersion')
if [[ "${SUB_SCHEMA_VERSION}" != "1.0" ]]; then
  log_error "Invalid submission schemaVersion: ${SUB_SCHEMA_VERSION}"
  exit 1
fi

# Verify recommendation has valid decision
DECISION=$(echo "${SUBMISSION}" | jq -r '.recommendation.decision')
VALID_DECISIONS=("APPROVE" "APPROVE_WITH_CONDITIONS" "REFER" "DECLINE" "INSUFFICIENT_INFORMATION")
VALID_DECISION=false
for valid in "${VALID_DECISIONS[@]}"; do
  if [[ "${DECISION}" == "${valid}" ]]; then
    VALID_DECISION=true
    break
  fi
done
if [[ "${VALID_DECISION}" != "true" ]]; then
  log_error "Invalid decision: ${DECISION}"
  exit 1
fi

log_success "Submission structure valid (decision: ${DECISION})"

# Step 9: Verify idempotency (second run with same ID returns same result)
log_info "Step 9: Testing idempotency..."
IDEMPOTENT_OUTPUT=$(mktemp)
if ! node apps/cli/dist/index.js run \
  --case "${CASE_PATH}" \
  --agent "${BASELINE_URL}" \
  --run-id "${RUN_ID}" \
  --json > "${IDEMPOTENT_OUTPUT}" 2>&1; then
  log_error "Idempotent run failed"
  cat "${IDEMPOTENT_OUTPUT}"
  exit 1
fi

IDEMPOTENT_RESULT=$(cat "${IDEMPOTENT_OUTPUT}")
IDEMPOTENT_RUN_DIR=$(echo "${IDEMPOTENT_RESULT}" | jq -r '.runDir')
IDEMPOTENT_STATUS=$(echo "${IDEMPOTENT_RESULT}" | jq -r '.status')

if [[ "${IDEMPOTENT_RUN_DIR}" != "${RUN_DIR}" ]]; then
  log_error "Idempotent run directory mismatch"
  log_error "  First:  ${RUN_DIR}"
  log_error "  Second: ${IDEMPOTENT_RUN_DIR}"
  exit 1
fi

if [[ "${IDEMPOTENT_STATUS}" != "completed" ]]; then
  log_error "Idempotent run status: ${IDEMPOTENT_STATUS}"
  exit 1
fi

log_success "Idempotency verified (same run directory returned)"

# Step 10: Verify score.json is not_scored (Phase 1)
log_info "Step 10: Verifying score.json is not_scored..."
if [[ -f "${RUN_DIR}/score.json" ]]; then
  SCORE=$(cat "${RUN_DIR}/score.json")
  echo "${SCORE}" | jq .
  SCORE_STATUS=$(echo "${SCORE}" | jq -r '.status')
  if [[ "${SCORE_STATUS}" != "not_scored" ]]; then
    log_error "Expected not_scored, got: ${SCORE_STATUS}"
    exit 1
  fi
  log_success "Score report correctly marked not_scored"
else
  log_warn "score.json not present (acceptable for Phase 1)"
fi

# All checks passed
log_info ""
log_info "========================================"
log_success "ALL SMOKE TESTS PASSED"
log_info "========================================"
log_info "Run directory: ${RUN_DIR}"
log_info "Events: ${SEQ}"
log_info "Decision: ${DECISION}"
log_info ""

exit 0
