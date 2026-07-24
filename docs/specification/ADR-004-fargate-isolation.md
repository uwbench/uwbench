# ADR-004: Fargate Isolation — No Task Role on Untrusted Evaluation Tasks

**Status:** Accepted
**Date:** 2025-07-24
**Deciders:** UWBench Maintainers
**Tags:** architecture, security, aws, fargate, isolation

---

## Context

UWBench runs untrusted participant agent code in AWS Fargate. The **critical security invariant** is that the agent container must have **zero access to AWS credentials** that could reach reference data, control plane APIs, other cases, or any resource beyond its scoped case inputs.

**The ECS Task Role Problem:**

> **The ECS task role is shared across ALL containers in a task.**

If the task has an IAM role, both the runner container AND the agent container inherit it. We cannot give the runner S3 write permissions without also giving them to the agent.

**Threats:**

- Agent uses task role to `s3:ListBucket` / `s3:GetObject` on reference archives bucket
- Agent calls `lambda:InvokeFunction` on scorer / control plane
- Agent accesses `dynamodb:GetItem` on submissions table
- Agent assumes role to escalate privileges
- Agent exfiltrates data via outbound internet (if NAT gateway attached)

**Requirements from SPEC:**

- Untrusted evaluation task: **No task role** (only execution role for image pull, logs, injected secrets)
- Runner gets short-lived, case-scoped presigned S3 URLs via environment variable overrides
- No shared volume between runner and agent
- No reference outputs or scorer code in evaluation task
- Scoring in separate trusted task/Lambda
- Three network tracks: `sealed` (no egress), `provider-network` (egress proxy), `remote-development` (participant endpoint, not certified)

## Decision

**Untrusted evaluation tasks run with NO TASK ROLE.** The agent container receives only:

1. **Execution role** (platform-managed): `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `logs:PutLogEvents`, `secretsmanager:GetSecretValue` (for provider API keys only)
2. **Presigned S3 URLs** injected at task start via container environment overrides (one for input archive GET, one for result archive PUT)
3. **Network track enforcement** via VPC configuration (no NAT for `sealed`, egress proxy for `provider-network`)

### Task Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ECS TASK: uwbench-eval-run_82e1 (NO TASK ROLE)                              │
│ Execution Role: arn:aws:iam::123456789012:role/uwbench-execution-role       │
│ Network Mode: awsvpc (dedicated ENI per task)                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ CONTAINER: runner                                                    │   │
│  │ Image: uwbench/runner:v1.0.0@sha256:abc123...                       │   │
│  │ Env:                                                                │   │
│  │   INPUT_ARCHIVE_URL=https://s3.../input.uwb?X-Amz-Signature=...     │   │
│  │   OUTPUT_ARCHIVE_URL=https://s3.../result.uwb?X-Amz-Signature=...   │   │
│  │   TOOL_FIXTURES_URL=https://s3.../fixtures.json?X-Amz-Signature=... │   │
│  │   TOOL_GATEWAY_PORT=8080                                            │   │
│  │   AGENT_ENDPOINT=http://localhost:9090                             │   │
│  │   RUN_ID=run_82e1                                                   │   │
│  │   CASE_ID=opaque_7f3e                                               │   │
│  │   BEARER_TOKEN=run_scoped_token_abc123                              │   │
│  │   BUDGET_WALL_CLOCK_SECONDS=900                                     │   │
│  │   BUDGET_MAX_TOOL_CALLS=100                                         │   │
│  │                                                                     │   │
│  │ Network: localhost (shared with agent container)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                         localhost:8080 (tool gateway)                      │
│                         localhost:9090 (agent protocol)                    │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ CONTAINER: agent (Participant Image)                                │   │
│  │ Image: participant/agent:v1.2.3@sha256:def456... (pinned digest)    │   │
│  │ Env:                                                                │   │
│  │   AGENT_RUN_URL=http://localhost:9090/v1/runs                      │   │
│  │   TOOL_GATEWAY_URL=http://localhost:8080/v1/tools/call             │   │
│  │   BEARER_TOKEN=run_scoped_token_abc123                              │   │
│  │   OPENAI_API_KEY=*** (from Secrets Manager, only if provider track)│   │
│  │                                                                     │   │
│  │ Network: SAME as runner (shared task network namespace)             │   │
│  │   - sealed: No egress (no NAT, no IGW, no VPC endpoints)           │   │
│  │   - provider-network: Egress via proxy (allowlist + TLS + limits)  │   │
│  │   - remote-development: Participant's endpoint (not certified)     │   │
│  │                                                                     │   │
│  │ Filesystem: Read-only rootfs (except /tmp)                         │   │
│  │ Capabilities: DROP ALL (no NET_RAW, no SYS_ADMIN, etc.)            │   │
│  │ Seccomp: Default profile (blocks ptrace, keyctl, etc.)             │   │
│  │ User: Non-root (UID 1000)                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Presigned URL Injection (Control Plane Responsibility)

Control plane (Step Functions → ECS RunTask) generates presigned URLs **at task start**:

```python
# Pseudocode: Control plane task launch
def launch_evaluation_task(run_id, case_id, agent_image_digest, network_track):
    # 1. Generate presigned URLs (expire at timeout + 5 min buffer)
    input_url = s3.generate_presigned_url(
        'get_object',
        Bucket='uwbench-cases',
        Key=f'input/{case_id}.uwb',
        ExpiresIn=run_timeout_seconds + 300
    )
    output_url = s3.generate_presigned_url(
        'put_object',
        Bucket='uwbench-results',
        Key=f'runs/{run_id}/result.uwb',
        ExpiresIn=run_timeout_seconds + 300
    )
    fixtures_url = s3.generate_presigned_url(
        'get_object',
        Bucket='uwbench-fixtures',
        Key=f'{case_id}/fixtures.json',
        ExpiresIn=run_timeout_seconds + 300
    )

    # 2. Build container overrides
    overrides = {
        'containerOverrides': [
            {
                'name': 'runner',
                'environment': [
                    {'name': 'INPUT_ARCHIVE_URL', 'value': input_url},
                    {'name': 'OUTPUT_ARCHIVE_URL', 'value': output_url},
                    {'name': 'TOOL_FIXTURES_URL', 'value': fixtures_url},
                    {'name': 'RUN_ID', 'value': run_id},
                    {'name': 'CASE_ID', 'value': opaque_case_id},  # NOT real case ID
                    {'name': 'BEARER_TOKEN', 'value': generate_run_token(run_id)},
                ]
            },
            {
                'name': 'agent',
                'environment': [
                    {'name': 'AGENT_RUN_URL', 'value': 'http://localhost:9090/v1/runs'},
                    {'name': 'TOOL_GATEWAY_URL', 'value': 'http://localhost:8080/v1/tools/call'},
                    {'name': 'BEARER_TOKEN', 'value': generate_run_token(run_id)},
                ]
            }
        ]
    }

    # 3. Inject provider API key if provider-network track
    if network_track == 'provider-network':
        overrides['containerOverrides'][1]['secrets'] = [
            {'name': 'OPENAI_API_KEY', 'valueFrom': 'arn:aws:secretsmanager:...:secret:openai-key'}
        ]

    # 4. Run task WITH NO TASK ROLE
    ecs.run_task(
        taskDefinition='uwbench-eval-task',
        overrides=overrides,
        networkConfiguration={
            'awsvpcConfiguration': get_network_config(network_track)
        },
        # NO taskRoleArn!
        executionRoleArn='arn:aws:iam::123456789012:role/uwbench-execution-role'
    )
```

### Network Track Implementation

| Track                | VPC Config                                            | Egress                                                                                  | Certification Eligible |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| `sealed`             | Private subnets, **no NAT, no IGW, no VPC endpoints** | **None**                                                                                | ✅ Yes                 |
| `provider-network`   | Private subnets, NAT → **Egress Proxy (Squid/Envoy)** | Proxy allowlist: declared model providers only, TLS required, byte limits, dest logging | ✅ Yes                 |
| `remote-development` | Private subnets, NAT → Internet                       | Participant's declared endpoint                                                         | ❌ No (dev only)       |

**Egress Proxy (provider-network):**

- Runs in separate managed VPC
- Allowlist: `api.openai.com`, `api.anthropic.com`, etc. (declared at registration)
- Enforces: TLS 1.2+, max 50MB/request, max 500MB/run, logs all destinations
- No access to AWS metadata service (IMDSv2 blocked by proxy)

### Trusted Scorer Task (Separate Task)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ECS TASK / LAMBDA: uwbench-scorer-run_82e1                                  │
│ Task Role: arn:aws:iam::123456789012:role/uwbench-scorer-role               │
│   Permissions:                                                             │
│     - s3:GetObject on uwbench-cases/input/* + uwbench-cases/reference/*    │
│     - s3:PutObject on uwbench-results/runs/{run_id}/*                      │
│     - lambda:InvokeFunction on judge APIs (if judge track)                 │
│     - secretsmanager:GetSecretValue for judge API keys                     │
│ Network: sealed (or judge-proxy for judge APIs)                            │
│                                                                             │
│ Input: presigned GET URLs for input.uwb + reference.uwb                    │
│ Output: score.json, details/, certificate payload → S3                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Container Hardening (Agent Container)

```dockerfile
# Participant images MUST adhere to (validated at ingestion):
FROM base-image

# 1. Non-root user
RUN useradd -u 1000 -m agent
USER 1000

# 2. Read-only rootfs (except /tmp, /home/agent)
# Enforced by Fargate: readonlyRootFilesystem=true

# 3. Drop all capabilities
# Enforced by Fargate: linuxParameters.capabilities.drop=["ALL"]

# 4. No shell, no package manager in final image (distroless preferred)

# 5. Healthcheck (for Fargate health checks)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:9090/health || exit 1
```

**Image Ingestion Pipeline (ADR-001 / SPEC):**

1. Participant submits public OCI reference (e.g., `ghcr.io/vendor/agent:v1.2.3@sha256:abc...`)
2. CodeBuild (quarantine) → `skopeo copy` → evaluator-controlled ECR
3. Scan copied image (Trivy, Syft SBOM)
4. Record: source URI, source digest, dest digest, scan result, import time
5. One immutable ECS task definition revision per copied digest

## Consequences

### Positive

- **Strong isolation**: Agent has no AWS credentials → cannot access reference data, control plane, other cases
- **Defense in depth**: Even if runner compromised, agent still has no credentials
- **Presigned URLs are self-limiting**: Scoped to single object, expire automatically
- **Network tracks enforce egress policy**: `sealed` = air-gapped; `provider-network` = controlled
- **Scorer separation**: Reference data only in trusted scorer task with its own role

### Negative

- **Complexity**: Two tasks per run (eval + scorer), presigned URL management, network track config
- **Latency**: Task startup (~30-60s cold) + presigned URL generation
- **Debugging**: Agent logs only via CloudWatch; no SSH/exec access

### Risks & Mitigations

| Risk                                | Mitigation                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Presigned URL leaked in logs        | URLs in env vars (not logs); runner redacts URLs in logs; short TTL           |
| Agent escapes container → host      | Fargate = microVM boundary; gVisor (future); read-only rootfs; dropped caps   |
| Runner compromised → agent inherits | Runner has no task role either; only presigned URLs (same as agent)           |
| Egress proxy bypass                 | Proxy in separate VPC; agent task has no direct route to IGW/NAT              |
| Participant image malicious         | Ingestion quarantine + scan + pin by digest; no task role limits blast radius |

## Alternatives Considered

### 1. Task Role with Scoped Permissions (Runner + Agent Share)

- **Pros**: Simpler (one role), runner can use AWS SDK directly
- **Cons**: **Agent gets same permissions** → fundamental violation of isolation
- **Verdict**: Rejected — violates core threat model

### 2. Separate Tasks for Runner and Agent (Two Task Definitions)

- **Pros**: Each gets own task role
- **Cons**: Cannot share `localhost` (tool gateway); need VPC endpoints / service mesh for runner↔agent comms; adds latency/complexity; Fargate doesn't support task-to-task localhost
- **Verdict**: Rejected — shared network namespace required for low-latency tool gateway

### 3. Sidecar Pattern with Separate Pod (EKS/Fargate Pod)

- **Pros**: Kubernetes-style isolation
- **Cons**: Not native Fargate; adds orchestration complexity; same localhost sharing issue
- **Verdict**: Rejected — stay with ECS task model

### 4. Agent Gets Read-Only Role to Input Bucket Only

- **Pros**: Agent can fetch own inputs directly
- **Cons**: Still has AWS creds; can enumerate bucket; presigned URLs are more precise (single object, time-limited)
- **Verdict**: Presigned URLs superior — principle of least privilege

### 5. Lambda for Agent Execution

- **Pros**: True isolation, no container escape risk
- **Cons**: 15-min timeout (runs up to 15 min), 10GB memory limit, no GPU, cold starts, custom runtime complexity
- **Verdict**: Fargate more flexible for participant images; Lambda for scorer (short, deterministic)

## References

- [SPEC.md](../../.agent-workflow/SPEC.md) — Hosted Architecture, Critical Fargate Correction, Network Tracks, Participant Image Ingestion
- [SECURITY.md](../security/SECURITY.md) — Threat model, STRIDE, critical invariants
- [ADR-001: Repository Boundary](../specification/ADR-001-repository-boundary.md) — Separate repo, no shared infra
- [ADR-003: Case Privacy](../specification/ADR-003-case-privacy.md) — Input/reference archive separation
- AWS ECS Task Role documentation: "The task role is shared by all containers in the task"
- AWS Fargate platform version 1.4+ (readonlyRootFilesystem, capability drop)
