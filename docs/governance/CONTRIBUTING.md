# Contributing to UWBench

UWBench accepts protocol, runner, scorer, documentation, and public-case
contributions. Contributions must preserve vendor neutrality, case privacy,
reproducibility, and deterministic-first scoring.

## Development workflow

1. Create a focused branch and keep unrelated changes separate.
2. Install the pinned toolchain with `pnpm install --frozen-lockfile`.
3. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and
   `pnpm generate`.
4. Confirm generation is clean with `git diff --exit-code` and
   `git status --porcelain`.
5. Add a Changeset for publishable package changes. Use an explicitly
   documented empty Changeset only for pre-release governance or
   non-publishable repository changes.
6. Open a pull request describing compatibility, security, privacy, and
   scoring implications.

Protocol changes must update Zod schemas, generated artifacts, parity tests,
the specification, and relevant ADRs in the same pull request. Do not include
private cases, expected outputs, reviewer identities, credentials, or
chain-of-thought.

Security vulnerabilities must follow [SECURITY.md](../../SECURITY.md), not the
public issue tracker. Governance and review requirements are defined in
[GOVERNANCE.md](GOVERNANCE.md).

Commercial-credit incumbents reviewing the job freeze or handbook
inventory should use the
[Phase 2 lender-review form](../practice-analysis/phase-2-lender-review.md)
or the GitHub issue template. Do not attach real borrower files. That
path is practice analysis, not a score submission.
