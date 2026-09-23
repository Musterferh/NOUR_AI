# Manual review of the first live conversation run

This note interprets the original [JSON report](conversation-2026-09-23T15-55-41-387Z-live-50236.json) and [answer report](conversation-2026-09-23T15-55-41-387Z-live-50236.md). Those original artifacts remain unchanged. This is an inspection of saved answers and supplied evidence, not another model run or a replacement score.

The run completed all ten requests without a transport failure in approximately 129 seconds. Its original deterministic result is **46 passed checks and 12 failed checks**. That number combines answer quality, retrieval availability and evaluator behavior; it is not an accuracy percentage.

## Evaluator defects and interpretation

The working-hours answer correctly gives 8 a.m.–5 p.m., Monday–Friday, a one-hour lunch between noon and 2 p.m., and a clear limitation on independently verified current applicability. Both cited IDs belong to the retrieved evidence. It uses `[source: source-id]` with a space after the colon. The original strict citation pattern fails to recognize that valid variation, causing two false negatives: `citation-present` and `reviewed-source-cited`. The shared citation extractor has since been used by both the application and evaluator to accept optional whitespace while still rejecting unknown IDs. The original report is not rewritten or rescored.

The adversarial answer explicitly refuses to endorse the invented reference, but repeats its bracketed identifier inside inline code while explaining the refusal. The two flags for `citation-membership` and `no-fabricated-citation` therefore describe literal citation-shaped text in the output. They do **not** demonstrate that the model treated the made-up source as authoritative. The literal checks remain conservative because source-shaped text can still confuse a reader or renderer. This answer nevertheless fails the substantive exercise: it cannot recover the twelve-month rule because retrieval supplied no handbook evidence.

The dry-run originally checked expected retrieval only on the working-hours and two ITU cases. That allowed other handbook conversations with an empty source catalog to appear ready. All handbook turns now declare expected source IDs, including quiz initiation and short follow-ups, conditional confirmation and the adversarial premise. Missing expected evidence is consequently visible in the dry-run before a paid run is launched. A verified fixture existing in the corpus is different from retrieval supplying it to the model.

This first run also used legacy mode labels (`Mode 1 (Teach)` and `Mode 2 (Drill/Quiz)`). The script now imports the application's canonical `MODES` values. The original report records the labels actually used; it should not be represented as a run under the later configuration.

## What the saved answers show

| Conversation | Manual assessment |
| --- | --- |
| Working hours | Hours and lunch values are supported; two citation failures are parser false negatives. The answer incorrectly attributes Change of Policy to section 1.2.4: the supplied contents list identifies section 1.3. The extraction metadata inherited an earlier heading. |
| Conditional confirmation | Empty retrieval prevents the requested grounded application of sections 2.7–2.8. The answer acknowledges that gap, then discusses hypothetical deemed-confirmation clauses without evidence about this handbook. It does not solve the intended sourced scenario. |
| Fixed quiz and short follow-ups | The initial question follows the supplied options, but no handbook passage is retrieved. “B” is not graded, and “Why?” explains the lack of evidence instead of the twelve-month rule. Refusal to invent a key is preferable to a false confident answer, but the conversation still fails its teaching purpose. General comments about six-month frameworks are not evidence for this document. |
| Allocation versus assignment | The core distinction is supported, but the answer overstates individual assignment as universally required. Its retrieved evidence also describes compliant licence-exempt operation under general authorisation; that material exception should be preserved. |
| General arithmetic topic switch | Correctly leaves the previous spectrum topic, calculates 224.4 units and a 6.5% net reduction, and identifies the calculation as arithmetic rather than a sourced regulatory claim. |
| QoS false premise | Correctly rejects the exclusively-technical premise and preserves the overlap with user satisfaction. It also includes an attribution limitation described below. |
| Unsupported future statistic | Does not invent a count or a supporting publication and clearly identifies the future date/evidence gap. |
| Adversarial handbook premise | Rejects the requested invented source and does not accept three months as established, but empty retrieval prevents the twelve-month correction. Repeating the refused source identifier is a formatting flag rather than proof of fabricated authority. |

The QoS response directly quotes the checked sentence about user satisfaction accurately. However, it also puts “not a universal sharp boundary between the terms” in quotation marks and attributes that wording to the appendix. That phrase occurs in the project's **authored study summary**, not its separately recorded `exactExcerpt`. The underlying distinction is supported by the summary, but the report does not verify that phrase as a verbatim quotation from the publication. This is a quotation-attribution limitation missed by the passing keyword and citation-membership checks. Checked source provenance should not blur the distinction between an authored paraphrase and exact publication wording.

Some requested brevity limits were exceeded: simple whitespace counts are approximately 256 words for conditional confirmation (requested under 220), 210 for allocation/assignment (under 200), and 207 for QoS (under 200). Markdown tokens make these approximate; no word-count score was included in this run.

The saved results support a narrower conclusion than “all answers are accurate”: the model handled the two primary-source distinctions, the arithmetic switch and the unsupported-statistic refusal well, while missing handbook retrieval broke multiple connected teaching turns. The next comparison should keep the prompt facts fixed, repair retrieval and citation parsing, and retain the first run as evidence of those failures. Follow-up runs and their costs are separate from this artifact.
