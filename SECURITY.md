# UWBench Security Policy

**Version:** 0.1.0
**Last Updated:** 2026-07-24
**Status:** Draft — pre-release
**Security Contact:** Repository maintainers through GitHub Security Advisories

---

## Reporting a Vulnerability

**Do not open public issues for security vulnerabilities.**

During the pre-release phase, report vulnerabilities through the repository's
private GitHub Security Advisory "Report a vulnerability" flow. This draft
does not advertise an email address or encryption key until maintainers have
verified and published an operational channel.

Include:

- Description of the vulnerability
- Steps to reproduce or proof-of-concept
- Affected components (protocol, runner, tool gateway, scorer, CLI, case packer)
- Potential impact (data exposure, scoring manipulation, runner escape, case privacy breach)
- Suggested fix (if any)

## Response Timeline

| Severity              | Acknowledgment | Triage    | Fix Target         | Coordinated Disclosure |
| --------------------- | -------------- | --------- | ------------------ | ---------------------- |
| Critical (CVSS ≥ 9.0) | ≤ 24h          | ≤ 48h     | ≤ 7 days           | ≤ 30 days              |
| High (CVSS 7.0–8.9)   | ≤ 48h          | ≤ 5 days  | ≤ 14 days          | ≤ 45 days              |
| Medium (CVSS 4.0–6.9) | ≤ 5 days       | ≤ 10 days | ≤ 30 days          | ≤ 60 days              |
| Low (CVSS < 4.0)      | ≤ 10 days      | ≤ 15 days | Next minor release | Next release notes     |

## Supported Versions

| Protocol Version  | Supported    | End of Support       |
| ----------------- | ------------ | -------------------- |
| 1.x               | Not released | N/A                  |
| 0.x (pre-release) | Best effort  | First stable release |

Only the latest minor of the current major receives security patches.

## Threat Model Summary

UWBench evaluates untrusted agent code against underwriting cases with known ground truth. The critical security properties are:

1. **Case Privacy**: Untrusted agents never access reference data (expected outputs, adjudication notes, scoring rubrics). Input and reference archives are physically separate `.uwb` files.
2. **Runner Isolation**: Untrusted evaluation tasks run on AWS Fargate with **no task role**. Agents receive only short-lived, case-scoped presigned S3 URLs.
3. **Scoring Integrity**: Deterministic scorers recalculate from ground truth. LLM judges (memo quality, 4% weight) are blinded, pinned, dual-family, with disagreement adjudication.
4. **Supply Chain**: Participant images are digest-pinned, quarantined, scanned, and copied to evaluator-controlled ECR before certification runs.
5. **Certificate Binding**: Signed certificates bind to immutable digests (protocol, scorer, benchmark, case-set, participant image, environment).

See [docs/security/SECURITY.md](docs/security/SECURITY.md) for the full threat model and STRIDE analysis.

## Security Controls

| Component            | Controls                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Protocol Schemas** | Zod validation on all inputs/outputs; generated JSON Schema + OpenAPI; CI drift detection                         |
| **Tool Gateway**     | Bearer token per run; callId idempotency; schema validation; budget enforcement; no filesystem access             |
| **Local Runner**     | In-process budgets; SIGTERM handling; hash-chained event log; result directory checksums                          |
| **Fargate Runner**   | No task role; presigned URL injection; network tracks (sealed/provider-network/remote-dev); resource limits       |
| **Trusted Scorer**   | Separate task/Lambda; receives both archives; no egress (or judge proxy); deterministic-first scoring             |
| **Case Packer**      | Validates: no traversal, no symlinks, unique IDs, citation bounds, deterministic policy rules, PII classification |
| **Certificates**     | RFC 8785/JCS canonicalization + KMS asymmetric signing; includes all version digests; revocable                   |
| **Dependencies**     | `pnpm audit` in CI; Dependabot alerts; pinned lockfile; minimal dependencies; SLSA L2 provenance for publishes    |

## Secure Development Practices

- All PRs require maintainer review; security-sensitive changes (auth, crypto, runner, scorer) require Security Coordinator review
- No secrets in repository; GitHub secret scanning enabled; local dev uses `.env.local` (gitignored)
- Conformance test suite validates protocol edge cases (malformed requests, oversized outputs, tool call after completion, etc.)
- Fuzzing on tool gateway inputs (planned)
- Penetration testing of runner/tool boundaries before accepting private certification cases

## Recognition

We recognize and thank security researchers who responsibly disclose vulnerabilities. With reporter permission, we acknowledge contributions in release advisories.

---

**Related Documents:**

- [GOVERNANCE.md](docs/governance/GOVERNANCE.md) — Governance, maintainer roles, release process
- [ADR-003: Case Privacy](docs/specification/ADR-003-case-privacy.md) — Input/reference archive separation
- [ADR-004: Fargate Isolation](docs/specification/ADR-004-fargate-isolation.md) — No task role, presigned URLs, network tracks
- [ADR-005: Score Versioning](docs/specification/ADR-005-score-versioning.md) — Immutable scorer versions in certificates
- [ADR-006: Judge Use](docs/specification/ADR-006-judge-use.md) — Blinded, pinned, dual-family judges
