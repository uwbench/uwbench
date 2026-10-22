# OO-Harness phase 2: fixed base vs router

Phase 2 fixes the citation bug in the base harness, then compares that fixed base with the router. The scorer, the rubric, and the split manifest (`fbfd604775247ff827f4c8303dfb15e10d24c971`) were not changed. The executor is still the deterministic tool procedure `tool-agent-baseline-v1`. No live model was called.

The harness change was frozen at `c02b8e4dcc49c2a5caf01cf6a52ee7c49959a575` before these runs. `BaseToolHarness` now cites a tool-returned `src_` record or policy id and does not cite `normalized:canonical-input`. `CitationAnchorHarness` was removed. `RecordCoverageHarness` and `PolicyBreachRiskHarness` inherit the fixed base. The router still selects record-coverage, then policy-breach risk, and otherwise keeps the base. The wrapper-citation route is gone. Fallback is unchanged: a specialist that throws, cites a wrapper id, cites a source the tools did not return, or emits no scored citation is discarded and the base result is kept.

Lane: `commercial-credit-v0.1`, `reasoning_only` only. Discovery was run again as a reference. The held-aside set was run for the first time, three seeds on each arm. There is no dollar cost. Cost is tool calls, plus the event-log span from the first to the last event. Final scores did not vary by seed. Tool-call counts did not vary by seed. Event-log duration did.

Scores below are the values stored in each run's `score.json`. Evidence and risk are that file's component `rawScore`. Fabricated citations are `rawCounts.fabricatedCitations` on the evidence component.

## Held-aside

Three seeds agreed on every cell. Score seed SD is 0.

| Case | Arm | Router branch | Final | Evidence | Risk | Fabricated | Tool calls | Event span mean (s) | Event span sample SD (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `case-00006` | fixed base |  | 77.87 | 1 | 0.5 | 0 | 29 | 0.138 | 0.005 |
| `case-00006` | routed | base | 77.87 | 1 | 0.5 | 0 | 29 | 0.137 | 0.004 |
| `case-00007` | fixed base |  | 84.8 | 1 | 0.5 | 0 | 28 | 0.137 | 0.002 |
| `case-00007` | routed | policy-breach-risk | 84.39 | 1 | 0.5 | 0 | 56 | 0.172 | 0.064 |
| `case-00010` | fixed base |  | 86.58 | 1 | 0.6 | 0 | 29 | 0.138 | 0.006 |
| `case-00010` | routed | base | 86.58 | 1 | 0.6 | 0 | 29 | 0.134 | 0.005 |
| `case-00003` | fixed base |  | 82.31 | 1 | 0.5 | 0 | 29 | 0.134 | 0.004 |
| `case-00003` | routed | record-coverage | 81.71 | 1 | 0.5 | 0 | 64 | 0.241 | 0.005 |
| `case-00008` | fixed base |  | 76.24 | 1 | 0.5 | 0 | 27 | 0.133 | 0.005 |
| `case-00008` | routed | record-coverage | 75.69 | 1 | 0.5 | 0 | 60 | 0.169 | 0.056 |

Paired delta is routed final minus fixed-base final. It was the same on all three seeds: `case-00006` 0, `case-00007` −0.41, `case-00010` 0, `case-00003` −0.60, `case-00008` −0.55.

Mean paired delta on the five held-aside cases: **−0.312**. Sample standard deviation (n−1) of those five deltas: **0.293**.

No held-aside run fell back from a specialist to the base. Where the router selected a specialist, the final score was lower than the fixed base and the tool-call count was about double, because the router still executes the base pass and then the specialist inside one run. Evidence stayed 1 and fabricated citations stayed 0 on both arms. There is no phase-1 base score for these cases, so the fixed-base gain over the old base is not defined here.

## Discovery reference

Three seeds agreed on every cell. Score seed SD is 0. The old base is the phase-1 seed-1 final score, before the citation fix.

| Case | Arm | Router branch | Final | Evidence | Risk | Fabricated | Tool calls | Old base final | Fixed-base gain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `case-00002` | fixed base |  | 82.33 | 1 | 0.5 | 0 | 35 | 70.33 | +12 |
| `case-00002` | routed | record-coverage | 81.62 | 1 | 0.5 | 0 | 76 |  |  |
| `case-00009` | fixed base |  | 83.29 | 1 | 0.5 | 0 | 31 | 71.29 | +12 |
| `case-00009` | routed | record-coverage | 82.83 | 1 | 0.5 | 0 | 68 |  |  |
| `case-00005` | fixed base |  | 75.25 | 1 | 0.5 | 0 | 27 | 63.25 | +12 |
| `case-00005` | routed | policy-breach-risk | 74.85 | 1 | 0.5 | 0 | 54 |  |  |
| `case-00004` | fixed base |  | 82.55 | 1 | 0.5 | 0 | 27 | 70.55 | +12 |
| `case-00004` | routed | policy-breach-risk | 82.15 | 1 | 0.5 | 0 | 54 |  |  |
| `case-00001` | fixed base |  | 85.96 | 1 | 0.6 | 0 | 31 | 73.96 | +12 |
| `case-00001` | routed | base | 85.96 | 1 | 0.6 | 0 | 31 |  |  |

The fixed base gained **12** final points on each of the five discovery cases (mean +12, sample SD 0). That is the evidence component moving from 0 to 1 after the wrapper citation was removed. Phase-1 evidence on these cases was 0 with 4 fabricated citations (`case-00005` had 5). Phase-2 fabricated citations are 0.

Discovery event-span means (sample SD), seconds: fixed base `case-00002` 0.149 (0.011), `case-00009` 0.129 (0.001), `case-00005` 0.133 (0.006), `case-00004` 0.137 (0.002), `case-00001` 0.133 (0.004). Routed: `case-00002` 0.250 (0.009), `case-00009` 0.233 (0.004), `case-00005` 0.197 (0.060), `case-00004` 0.200 (0.053), `case-00001` 0.134 (0.007).

## What the held-aside comparison says

After the citation fix, the router does not improve the final score. On the five held-aside cases the mean paired delta is −0.312, which is a loss, and the score seed SD is 0, so the loss is not seed noise. The loss appears only when a specialist runs, and it matches the extra tool calls in that same run. When the router keeps the base (`case-00006`, `case-00010`), the final score, the evidence score, the risk score, the fabricated-citation count, and the tool-call count match the fixed base.
