# Design partners

**Status:** Part A is open. Phase 1 exists. The peer scorecard, private
real-case runs, operational tracks, and cohort rules are planned. They
are not in v0.1.

## Problem

Lenders are being asked to approve AI underwriting agents, and almost no
public evaluation exists for that job. Vendor claims are hard to check.
A generic model benchmark does not show whether an agent invents a
figure, misses a missing document, or follows the lender's policy.

Phase 1 is a public set of synthetic loan files, with a runner, scorers,
and a CLI that anyone can run. That part exists.

## Status

| Piece | Status |
| --- | --- |
| Phase 1 synthetic loan files, runner, scorers, CLI | **Exists** |
| Phase 2 Part A review form | **Open now** |
| Phase 2 Part B private real-case runs | **Planned** |
| Phase 2 Part C: PII before the model, retention, audit tracks | **Planned** |
| Anonymization and cohort rules | **Planned.** Published before any peer statistic. |
| Certification Board | **On paper** ([GOVERNANCE.md](governance/GOVERNANCE.md)). Not yet formed. |

Parts B and C have no code in this repository. v0.1 does not test them.
Scope for the three parts is in the
[practice-analysis README](practice-analysis/README.md#phase-2-scope-updated-october-2026).

## What partners get

Open now:

- A say in the job and the inventory. Corrections go through the Part A
  review form, which exists.
- A vendor-neutral way to test an agent on the public synthetic cases.
  Any agent that speaks the protocol can run, including one a lender is
  evaluating. This repository does not import a participant's product
  code.

Planned. Not built:

- A private peer scorecard, with Part B. The lender's own policy and
  decisions sit next to an anonymized peer distribution: decision
  agreement, conditions, follow-ups, and time to decision. Only that
  partner sees its own row. No peer statistic is shown until the cohort
  rules are published.
- A runner in the lender's own cloud. The runner and scorers are
  packaged to run inside that environment, on that lender's files, and
  to export only a signed score bundle. Borrower data does not leave.
  Partners are asked to shape this before it is final.
- Part C test tracks: borrower PII does not reach the model, retention
  and deletion, and an audit trail. Scoped with partners. Not in the
  current scorecard.
- First in line for a governance seat when the Certification Board
  forms. No seat exists yet. No participant has a reserved seat.

## What partners give

- One credit lead (a credit analyst, underwriter, or credit officer) to
  review the job and the inventory through the Part A form. The form
  exists now.
- Feedback on the runner and on the cohort rules before they are final.
- Later, and only if the lender chooses: a small set of adjudicated
  real cases (cases a credit officer has already decided), run in the
  lender's own environment. Results can stay private. That is a
  separate decision from Part A.

## Time commitment

About 2 hours for the Part A review. Then a 30 minute call once a month
while Part B and Part C are being built. A private run is a separate
decision, made later.

## Guardrails

- No borrower PII in reviews or in exports. Real cases never leave the
  lender's environment.
- No peer statistic for any cell with fewer than 5 institutions.
- Cohort keys stay coarse: institution type, asset band, region, and
  product. Small cells are suppressed.
- No partner is named in anything published without written consent.
  No reidentification.
- Review comments shape the inventory. They do not create scores or
  rankings. See
  [how the review is used](practice-analysis/phase-2-lender-review.md#how-uwbench-will-use-this).

These are the rules a partner is asked to hold the project to. The
written anonymization and cohort spec (suppression, noise, and who holds
the aggregate) is still planned. No peer statistic is published before
that spec.

## Reference participant

SecureLend is a reference participant, not the owner of this repository,
and has no reserved seat. See
[GOVERNANCE.md](governance/GOVERNANCE.md).

## Next step

Open the [Part A review form](practice-analysis/phase-2-lender-review.md).
File it as an issue titled
`Phase 2 review: <institution type>, <role>`, or use the
[issue template](https://github.com/uwbench/uwbench/issues/new?template=phase-2-lender-review.md).

Do not attach real borrower files, live policies, or client names.
