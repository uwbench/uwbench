# UWBench Governance

**Status:** Active — Phase 0
**Version:** 0.1.0
**Last Updated:** 2025-07-24

---

## 1. Purpose

This document defines the governance structure for the UWBench project. UWBench is an open-source benchmark for underwriting agents, released under the Apache-2.0 license. It is a **separate repository** from SecureLend and any other participant — SecureLend is the first reference participant, not the owner.

Governance exists to:

- Keep the benchmark vendor-neutral and reproducible
- Ensure protocol stability for all participants
- Provide a transparent path for contributions, releases, and leadership changes
- Protect case privacy and scoring integrity

---

## 2. Roles

| Role                             | Scope                                                                        | Selection                                                     | Term                                   |
| -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------- |
| **Maintainers**                  | Merge rights, release cuts, triage, security coordination                    | Nominated by existing maintainers; confirmed by consensus     | Indefinite, subject to activity review |
| **Contributors**                 | PRs, issues, reviews, case authoring, scorer improvements                    | Open to all; no nomination needed                             | N/A                                    |
| **Security Coordinators**        | Vulnerability intake, disclosure coordination, patch releases                | Appointed by maintainers                                      | 1 year, renewable                      |
| **Release Manager**              | Cut releases, sign artifacts, publish changelogs                             | Rotating among maintainers                                    | Per release cycle                      |
| **Certification Board (future)** | Adjudicate certification cases, approve judge models, approve rubric changes | Independent body, appointed by maintainers + external experts | 2 years, staggered                     |

> **SecureLend participates as a contributor.** SecureLend employees may become maintainers through the same nomination process as any contributor. No special governance seat is reserved for SecureLend.

---

## 3. Decision Making

### 3.1 Routine Decisions

- PR reviews, bug fixes, documentation updates, case additions: **Maintainer merge** (1 approval from a maintainer not author)
- New public cases, scorer improvements, protocol clarifications: **Maintainer consensus** (no objection from any maintainer within 5 business days)

### 3.2 Significant Decisions (Require ADR)

- Protocol version changes (v1 → v2)
- Scoring component weight changes
- New evaluation lanes or benchmark tracks
- Judge model certification criteria
- Certification case governance
- Governance or security policy changes

**Process:**

1. Author opens an ADR (see `docs/specification/ADR-*.md` template)
2. 10 business day discussion period
3. Maintainer consensus (no sustained objection)
4. ADR marked `Accepted` and merged
5. Implementation tracked in linked issues

### 3.3 Security Decisions

- Vulnerability disclosure, patch coordination, disclosure timeline: **Security Coordinators decide** (see `SECURITY.md`)
- Maintainers informed within 24h; public disclosure coordinated per policy

---

## 4. Contribution Process

### 4.1 Contributor License

All contributions are made under the Apache-2.0 license. By submitting a PR, contributors certify they have the right to license their contribution under Apache-2.0 (Developer Certificate of Origin 1.1 implied).

### 4.2 Pull Request Requirements

- **DCO sign-off** (`git commit -s`) required on all commits
- **CI must pass**: lint, typecheck, tests, schema generation drift check
- **ADR required** for significant decisions (see §3.2)
- **Tests required** for new protocol schemas, scorers, tools, cases
- **Documentation updates** required for user-facing changes
- **No SecureLend-internal dependencies** — all code must be vendor-neutral

### 4.3 Case Contributions

Public cases follow the case authoring guide (`docs/case-authoring/CASE_AUTHORING.md`):

1. Author case in `benchmark/<track>/public-cases/case-XXXXX/`
2. Run `uwbench validate-case` — must pass
3. Run deterministic baseline — must produce valid `submission.json`
4. PR includes case directory + validation output
5. Maintainer review: structure, privacy (no private refs in public case), schema conformance

**Certification cases** are never submitted to the public repo. They are managed in a separate, access-controlled repository governed by the Certification Board.

---

## 5. Release Process

### 5.1 Versioning

- **Protocol version** (`protocolVersion` in run requests): SemVer, tied to `packages/protocol` version
- **Scorer versions**: Each scorer package (`scorer-financial`, `scorer-policy`, etc.) versions independently; `scorer-core` aggregates versions into a `ScorerSuiteVersion`
- **CLI / Runner / Tool Runtime**: Versioned together as `@uwbench/cli`, `@uwbench/runner`, `@uwbench/tool-runtime` (monorepo lockstep)
- **Benchmark tracks**: `commercial-credit-v0.1`, `commercial-credit-v0.2`, etc. (track + semantic version)
- **Certificates**: Signed with `certificateVersion` referencing protocol + scorer suite + benchmark version

### 5.2 Release Cadence

| Artifact               | Cadence    | Trigger                                                        |
| ---------------------- | ---------- | -------------------------------------------------------------- |
| Protocol patch (patch) | As needed  | Bug fix, schema clarification                                  |
| Protocol minor         | ~6 weeks   | New tools, optional fields, new optional lanes                 |
| Protocol major         | ~6 months  | Breaking schema changes, lane removal, scoring formula changes |
| Scorer patch           | As needed  | Bug fixes, tolerance adjustments                               |
| Scorer minor           | ~6 weeks   | New rules, rubric clarifications                               |
| CLI/Runner patch       | As needed  | Bug fixes                                                      |
| Benchmark track minor  | ~3 months  | New public cases, lane additions                               |
| Benchmark track major  | ~12 months | Schema version bump, lane removal, scoring weight changes      |

### 5.3 Release Checklist (Maintainer)

1. All CI passes on `main`
2. Changelog updated (`CHANGELOG.md` via changesets)
3. Version bump via `pnpm changeset version`
4. `pnpm build` + `pnpm generate` (schemas, OpenAPI, Markdown)
5. `pnpm changeset publish` (npm publish with provenance)
6. Git tag: `protocol-vX.Y.Z`, `cli-vX.Y.Z`, `track-commercial-credit-vX.Y.Z`
7. GitHub Release with artifacts, changelog, and **provenance attestation** (SLSA)
8. Update `docs/specification/generated/` with generated artifacts
9. Announce in GitHub Discussions + Discord (if applicable)

### 5.4 Breaking Changes

- **Protocol major**: Requires ADR, 6-week deprecation window for prior minor, migration guide in release notes
- **Scorer weight changes**: Always minor or major (never patch); require ADR
- **Case schema changes**: Require new `benchmarkVersion`; old cases remain runnable under old version

---

## 6. Maintainer Onboarding / Offboarding

### Onboarding

1. Sustained contribution history (3+ merged PRs over 3+ months)
2. Nomination by existing maintainer (GitHub issue)
3. 10-business-day comment period
4. Consensus of current maintainers (no objection)
5. Invite to `uwbench-maintainers` GitHub team, add to `MAINTAINERS.md`

### Offboarding

- Voluntary: PR removing from `MAINTAINERS.md` and GitHub team
- Inactivity (no maintainer activity 6 months): Maintainer consensus → move to Emeritus
- Code of Conduct violation: Security Coordinators + Maintainer consensus → immediate removal

---

## 7. Code of Conduct

All participants are bound by the [Code of Conduct](../../CODE_OF_CONDUCT.md) (Contributor Covenant v2.1). Enforcement follows the process defined there.

---

## 8. Trademark & Branding

- "UWBench" and the UWBench logo are trademarks of the UWBench project.
- Participants may say "runs on UWBench" or "UWBench-compatible agent" if they pass the public conformance suite.
- No participant may claim "UWBench certified" without a signed certificate from the Certification Board.

---

## 9. Amendments

This governance document may be amended by the ADR process (§3.2). Changes require an ADR and maintainer consensus.

---

## 10. References

- [SECURITY.md](../security/SECURITY.md) — Vulnerability disclosure, threat model
- [ADR-001: Repository Boundary](../specification/ADR-001-repository-boundary.md)
- [ADR-002: Agent Protocol](../specification/ADR-002-agent-protocol.md)
- [ADR-003: Case Privacy](../specification/ADR-003-case-privacy.md)
- [ADR-004: Fargate Isolation](../specification/ADR-004-fargate-isolation.md)
- [ADR-005: Score Versioning](../specification/ADR-005-score-versioning.md)
- [ADR-006: Judge Use](../specification/ADR-006-judge-use.md)
- [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md)
- [SECURITY.md](../../SECURITY.md)
