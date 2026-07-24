# ADR-005: Score Versioning — Immutable Scorer Versions Bound to Certificates

**Status:** Accepted
**Date:** 2025-07-24
**Deciders:** UWBench Maintainers
**Tags:** architecture, scoring, versioning, reproducibility

---

## Context

UWBench scores are the primary output of the benchmark. They must be:

- **Reproducible**: Same agent + same case + same scorer version = identical score
- **Auditable**: Every score component identifies its exact scorer version and rubric version
- **Comparable**: Scores across runs can be compared only when scorer versions match
- **Certificate-bound**: Signed certificates reference exact scorer versions used

**Requirements from SPEC:**

- Each component score names the exact scorer version
- ≥70% of published score is deterministic
- Scorer versions: protocol/runner/scorer/rubric/judge versions all recorded in certificate
- Rerun under new scorer/judge → new certificate; old not silently rewritten
- Scorer implementations are separate packages: `scorer-financial`, `scorer-policy`, `scorer-risk`, `scorer-evidence`, `scorer-workflow`, `scorer-decision`, `scorer-core` (aggregation)

## Decision

**Every scorer package versions independently (SemVer). A `ScorerSuiteVersion` aggregates them for certificates. Scores are immutable once computed.**

### Versioning Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    ScorerSuiteVersion v1.2.0                    │
│  (aggregated in scorer-core, pinned at run start)               │
├─────────────────────────────────────────────────────────────────┤
│  scorer-financial   v1.3.0  │  Deterministic ratio recalc       │
│  scorer-policy      v1.1.0  │  Rule evaluation + caps           │
│  scorer-risk        v1.0.0  │  Concept matching + semantic fb   │
│  scorer-evidence    v1.0.0  │  Citation anchors + claim support │
│  scorer-workflow    v1.0.0  │  Event analysis                   │
│  scorer-decision    v1.0.0  │  Utility matrix + calibration     │
│  scorer-core        v1.2.0  │  Aggregation, caps, not_scored    │
└─────────────────────────────────────────────────────────────────┘
```

### Scorer Version Contract

Each scorer package exports:

```typescript
// scorer-financial/package.json
{ "name": "@uwbench/scorer-financial", "version": "1.3.0" }

// scorer-financial/src/version.ts
export const SCORER_VERSION = "1.3.0";
export const SCORER_NAME = "scorer-financial";
export const RUBRIC_VERSION = "1.0.0";  // Separate from code version
export const WEIGHT = 0.18;              // Scorecard weight (governed by ADR)
```

### Score Output Includes Version Metadata

Every component score **must** include:

```json
{
  "component": "financial_spread_accuracy",
  "score": 0.92,
  "weight": 0.18,
  "scorer": {
    "name": "scorer-financial",
    "version": "1.3.0",
    "rubricVersion": "1.0.0"
  },
  "details": { ... }
}
```

### Suite Version in Certificate

Signed certificate includes:

```json
{
  "certificateVersion": "1.0",
  "scorerSuiteVersion": "1.2.0",
  "componentVersions": {
    "scorer-financial": "1.3.0",
    "scorer-policy": "1.1.0",
    "scorer-risk": "1.0.0",
    "scorer-evidence": "1.0.0",
    "scorer-workflow": "1.0.0",
    "scorer-decision": "1.0.0"
  },
  "protocolVersion": "1.0.0",
  "runnerVersion": "1.0.0",
  "judgeVersions": ["gpt-4o-2024-08-06", "claude-3-5-sonnet-20241022"],
  "judgePromptVersion": "memo-v1.1",
  "rubricVersions": { ... },
  "benchmarkVersion": "commercial-credit-v0.1.0",
  "caseSetHash": "sha256:...",
  "participantImageDigest": "sha256:...",
  "environmentFingerprint": { "networkTrack": "sealed", ... }
}
```

### Immutability Rules

1. **Scores never change retroactively** — Once a run completes, its score is frozen
2. **New scorer version = new certificate** — Re-scoring with updated scorer produces new certificate with new `certificateId`; original certificate remains valid but marked `superseded: true` if rejudged
3. **Certificate revocation only for cause** — Fraud, protocol violation, critical scorer bug (ADR process)
4. **`not_scored` is a valid component result** — Phase 1 runs produce `not_scored` for judge-dependent components; explicitly versioned

### Rubric Versioning (Separate from Code)

- **Rubric version** (`rubricVersion`) changes when: scoring thresholds, tolerances, concept definitions, weight distributions change
- **Code version** changes when: bug fixes, performance, refactoring (no scoring logic change)
- Both recorded in certificate
- Rubric changes require ADR + maintainer consensus (see GOVERNANCE.md)

### Local Runner Enforces Version Pinning

- `LocalRunner` reads `scorerSuiteVersion` from config at start
- All scorer packages loaded at that version (via pnpm workspace protocol or pinned deps)
- Result directory includes `scorer-versions.json` with exact versions used

## Consequences

### Positive

- **Full reproducibility**: Every score component traceable to exact code + rubric
- **Certificate integrity**: Certificates bind to immutable versions; no silent rewrites
- **Independent evolution**: Financial scorer can patch without bumping policy scorer
- **Auditability**: Anyone can verify score by re-running with same versions
- **`not_scored` tracked**: Phase 1 transparency about what's not yet scored

### Negative

- **Version explosion**: Many small packages, each with own version
- **Suite coordination**: `scorer-core` must aggregate compatible versions
- **Certificate size**: Full version manifest in every certificate

### Risks & Mitigations

| Risk                                                | Mitigation                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Scorer version drift across packages                | `scorer-core` declares `peerDependencies` with exact versions; CI validates lockfile |
| Participant claims "scored with v1.2" but used v1.1 | Certificate includes full version manifest; verification checks match                |
| Rubric change without version bump                  | Rubric version separate from code; CI checks rubric hash vs declared version         |
| Old scores invalidated by new rubric                | Never — old certificates remain valid; new runs get new certificates                 |

## Alternatives Considered

### 1. Single Monolithic Scorer Package with One Version

- **Pros**: Simpler versioning
- **Cons**: Any change bumps everything; no independent evolution; heavier deps for participants who only want one scorer
- **Verdict**: Rejected — scorers have different maturity timelines

### 2. Git Commit Hash Instead of SemVer

- **Pros**: Absolute precision
- **Cons**: Not human-readable; no semver semantics (patch vs minor vs major); npm ecosystem expects semver
- **Verdict**: SemVer + git tag (`scorer-financial-v1.3.0`) for traceability

### 3. Score Version Embedded in Case (Not Scorer)

- **Pros**: Case defines how it's scored
- **Cons**: Scorers evolve independently of cases; new scorer should score old cases; case shouldn't dictate scorer version
- **Verdict**: Scorer versions independent; case references benchmark version which implies compatible scorer suite

### 4. No `not_scored` — Just Omit Unscored Components

- **Pros**: Cleaner output
- **Cons**: Loses transparency about what _wasn't_ scored; can't distinguish "scored 0" from "not evaluated"
- **Verdict**: Explicit `not_scored` with version tracking (Phase 1 requirement)

## References

- [SPEC.md](../../.agent-workflow/SPEC.md) — Scoring v0.1 Scorecard, Certificates, LLM Judges
- [GOVERNANCE.md](../governance/GOVERNANCE.md) — Release process, rubric versioning
- [ADR-002: Agent Protocol](../specification/ADR-002-agent-protocol.md) — Protocol version in certificate
- [ADR-006: Judge Use](../specification/ADR-006-judge-use.md) — Judge versions in certificate
- `packages/scorer-core/src/version.ts` — Suite version aggregation
- `packages/scorer-*/src/version.ts` — Per-scorer version exports
