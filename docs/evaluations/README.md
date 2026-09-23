# NOUR live evaluation — 24 September 2026

Deeper reasoning, source provenance and repeatable live evaluation are implemented. The live work found and repaired real retrieval failures; it also showed that generated answers still need source review. These results are not a general intelligence or factual-accuracy percentage.

## What changed

- Kimi K3 uses bounded high reasoning for analytical questions and exam generation, with low effort for ordinary recall.
- Four small NCC/ITU reference passages have publication links, checked dates, exact excerpts and explicit currency limitations. The 1,422 original chunks remain available without being relabeled as independently verified.
- Retrieval handles formatting instructions, explicitly named documents and short follow-ups. It repairs visibly inconsistent extracted section labels conservatively.
- The prompt distinguishes supplied facts, inference, current applicability and missing evidence. Private provider reasoning is never displayed or saved in the conversation.
- Citation validation handles surrounding whitespace and grouped references; unknown IDs still receive a source-check notice.

## Recorded runs

| Run | Outcome | Evidence |
| --- | --- | --- |
| Initial HTTP check | Found that output-format instructions displaced the checked spectrum source; temporary session removed | [Initial check](2026-09-24-http-initial.json) |
| First full live suite | 10 completed turns, 46 passed and 12 failed automatic checks; missing handbook retrieval and citation-parser false negatives exposed | [Original answers](conversation-2026-09-23T15-55-41-387Z-live-50236.md), [manual review](conversation-2026-09-23T15-55-41-387Z-live-50236-review.md) |
| Second full live suite | 10 completed turns, 64 passed and 3 failed automatic checks; no transport failures or skipped turns | [Answers and checks](conversation-2026-09-23T16-05-16-201Z-live-6280.md), [machine-readable report](conversation-2026-09-23T16-05-16-201Z-live-6280.json) |
| Latest actual HTTP check | Two completed answers, four persisted messages, checked-source metadata retained, identical saved answer/source replay; temporary session removed | [HTTP report](2026-09-24-http-smoke.json) |

The second suite added missing-evidence checks, so the totals have different denominators. Do not turn this comparison into an accuracy percentage. Both suites used the configured `kimi-k3`, fixed learner prompts and bounded production reasoning budgets. Reports include timings, parameters and source/code hashes. The original reports have not been rewritten to make failures disappear.

The second suite correctly recovered the handbook's stated working hours and twelve-month probation period, rejected the six-month quiz answer, and understood its subsequent “Why?”. It calculated 224.4 units and a 6.5% net reduction after a topic switch; corrected the exclusively-technical QoS premise; declined to invent a future subscriber statistic; and corrected the adversarial three-month probation claim.

## Remaining limitations found by answer review

The three automatic flags in the second report have two causes. A grouped citation containing two real IDs was parsed as one unknown ID; the shared parser has since been corrected and tested. The adversarial answer refused the invented reference but echoed its citation-shaped text, triggering two literal-reference checks. That was a formatting failure, not endorsement of the fabricated source. The original flags remain in the report.

Manual review identifies issues that passing keyword checks miss:

- The spectrum scenario still says an individual assignment is required without preserving the supplied passages' general-authorisation/exemption alternative. The latest HTTP answer avoids that blanket requirement, but its follow-up overstates that allocation sets no operating conditions; allocation-table footnotes and interference restrictions require a more qualified explanation.
- The confirmation response says the entire handbook contains no deeming provision. Only the supplied sections were reviewed, so the claim should be limited to those passages.
- The quiz follow-up gives a plausible rationale for twelve months without clearly labeling that rationale as inference rather than the handbook's stated reason.
- Requested brevity is not consistently followed. Optional self-checks and elaboration sometimes remain.

These are open answer-quality limitations, not failed authentication, storage or streaming. The app should not describe generated answers as independently verified merely because their source IDs are valid. A four-passage checked supplement does not certify the rest of the bank or current regulatory status.

After the second run loaded its corpus snapshot, the NCA publication field was conservatively changed from the printed Act date to the year `2003`. The printed 8 July date remains separately identified. That metadata-only correction changes the supplement file hash; it does not change any ITU or handbook passage used in the live cases.

## Reproduce

```powershell
npm run eval:conversation -- --dry-run
npm run eval:conversation -- --live --output docs/evaluations
```

The second command incurs provider charges. It runs at most ten calls by default, with explicit input, completion-token and time limits and no automatic retries. See the [evaluation guide](../conversation-evaluation.md) for selective cases, caps, interpretation and manual review requirements. Ordinary `npm test` and browser tests use mocks and do not call paid providers.
