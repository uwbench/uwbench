# ADR-001: Repository Boundary — UWBench is a Separate Public Repository

**Status:** Accepted
**Date:** 2025-07-24
**Deciders:** UWBench Maintainers
**Tags:** architecture, governance, boundaries

---

## Context

SecureLend is a commercial underwriting product. UWBench is an open-source benchmark for underwriting agents. The two must remain architecturally and legally distinct.

**Key constraints:**
- UWBench is Apache-2.0 licensed; SecureLend is proprietary
- SecureLend is the *first reference participant*, not the owner
- The integration seam is the **UWBench Agent Protocol (HTTP/JSON)** — SecureLend adapts *to* the protocol, not the other way around
- No SecureLend billing, tenancy, Cognito, or internal credentials may exist in the UWBench repo
- No `benchmark: true` branches in SecureLend code; SecureLend must refactor to dependency injection (DI) so the same harness runs in production and benchmark modes

## Decision

**UWBench is a separate Git repository at `/Users/tobias/Development/uwbench` (public, Apache-2.0).**

```
Users/tobias/Development/
├── securelend/             # SecureLend product (participant)
├── securelend-frontend/    # SecureLend UI
└── uwbench/                # UWBench benchmark (this repo)
```

**Boundaries enforced:**
1. **No internal SecureLend imports** in UWBench code (no `securelend/*`, no SecureLend SDKs)
2. **No shared infrastructure code** — UWBench defines its own CDK, its own control plane, its own runner
3. **Protocol is the contract** — `packages/protocol` is the single source of truth for agent/tool/event/submission schemas. SecureLend implements an adapter *to* the protocol.
4. **No SecureLend CI/CD secrets** in UWBench workflows
4. **No SecureLend test data** in UWBench benchmarks — UWBench has its own case authoring process and public/private case split
5. **Governance is independent** — SecureLend contributors follow the same contributor/maintainer process as anyone else

## Consequences

### Positive
- **Vendor neutrality**: Any participant (including competitors) can implement the protocol without SecureLend dependencies
- **Clear IP boundary**: Apache-2.0 repo has no proprietary contamination risk
- **Independent release cadence**: UWBench protocol/scorer releases don't block SecureLend product releases
- **Community trust**: External contributors see a genuinely open project, not a vendor showcase

### Negative
- **Duplication effort**: SecureLend must build/maintain an adapter (`uwbench-run-adapter`, `uwbench-tool-client`, etc.)
- **Protocol stability pressure**: Breaking protocol changes require SecureLend adapter updates; ADR process required for protocol majors

### Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| SecureLend drifts from protocol | Protocol conformance test suite (`packages/testkit`) run in SecureLend CI |
| SecureLend uses internal shortcuts | Adapter must use ONLY tools advertised by case; CI validates no internal service calls in benchmark mode |
| Protocol changes break SecureLend | Protocol follows semver; 6-week deprecation window for breaking changes; migration guide required |

## Alternatives Considered

### 1. Monorepo (SecureLend + UWBench together)
- **Rejected**: License conflict (Apache-2.0 vs proprietary), governance conflict, IP leakage risk, no vendor neutrality

### 2. UWBench as SecureLend-internal package, published to npm only
- **Rejected**: Not truly open source; no external contribution path; SecureLend controls releases; certification cases would live in proprietary repo

### 3. Protocol defined in SecureLend, UWBench consumes as dependency
- **Rejected**: Inverts ownership; protocol changes driven by product needs; external participants second-class

### 4. Separate repo but shared internal packages (e.g., `securelend-shared-types`)
- **Rejected**: Creates hidden coupling; Shared types become de facto protocol without governance

## References
- [SPEC.md](../../../SPEC.md) — Core Principle: "UWBench is a separate Apache-2.0 repository"
- [GOVERNANCE.md](../governance/GOVERNANCE.md) — Governance independence
- [ADR-002: Agent Protocol](../specification/ADR-002-agent-protocol.md) — Protocol as the integration seam
- [ADR-003: Case Privacy](../specification/ADR-003-case-privacy.md) — Case separation mirrors repo boundary