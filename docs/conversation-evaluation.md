# Conversation evaluation

This harness runs ten fixed, synthetic learner turns through the application's actual retrieval, coaching prompt, reasoning selection, Kimi stream client and provider SSE parser. It checks reference facts, a conditional scenario, short follow-ups, a topic switch with arithmetic, unsupported evidence and false premises. Two cases use the checked ITU primary-source supplement. Each report preserves the public answers, retrieved evidence, latency, selected effort, fixed checks and a manual review rubric.

These are regression checks, not proof of general intelligence or universal factual accuracy. No model judges another model here. A passing regular expression can still appear inside a contradiction or an incorrect quotation, and a correct paraphrase can fail a pattern. Read the saved answers and sources before describing the run as successful.

## Run safely

Install the project's dependencies first. A dry-run requires no provider credential and makes **zero provider calls**:

```powershell
node --import tsx scripts/evaluate-conversation.ts --dry-run
node --import tsx --test tests/evaluation.test.ts
```

The dry-run verifies pinned reference metadata and runs the real local retrieval for every prompt. Later turns use explicitly simulated assistant replies for planning. It does not produce or grade model answers. Investigate any missing or changed reference or retrieval failure before spending on a live run.

Live calls require the explicit `--live` flag and the same `KIMI_API_KEY`, optional `KIMI_MODEL` and optional `KIMI_BASE_URL` used by the app. The default model is `kimi-k3`. With a current Node version, the command below loads the existing local environment and uses operating-system certificate trust. It does not bypass TLS checks.

```powershell
node --use-system-ca --env-file-if-exists=.env.local --import tsx scripts/evaluate-conversation.ts --live --output docs/evaluations
```

Without `--output`, reports go to the ignored `.npm-cache/evaluations` directory. Every run writes a uniquely named JSON report and a Markdown report; existing files are not overwritten. The console prints case/turn IDs, progress, effort, completion ceiling, elapsed time and check failures, without dumping prompts, answers or credentials. Review reports before sharing them, even though the test prompts contain only synthetic data and credentials are redacted.

To run just one conversation, repeat `--case` as needed:

```powershell
node --use-system-ca --env-file-if-exists=.env.local --import tsx scripts/evaluate-conversation.ts --live --case primary-qos-false-premise --output .npm-cache/evaluations
node --import tsx scripts/evaluate-conversation.ts --help
```

Exit code `0` means the selected checks completed without recorded failures or skips; it does not establish semantic correctness. Code `2` reports a failed check, failed turn or skipped turn. Code `1` reports a configuration, argument, corpus-loading or report-writing error.

## Bounded spend and runtime

The default Kimi K3 budgets match the application's selected effort: low uses at most 8,192 completion tokens and 120 seconds; high uses at most 16,384 completion tokens and 240 seconds. Automatic routing never selects maximum effort. `--max-tokens` and `--timeout-ms` can lower those ceilings; a lower budget is a different evaluation condition and should be identified in comparisons.

| Bound | Default | Absolute CLI maximum | Flag |
| --- | ---: | ---: | --- |
| Provider requests | 10 | 12 | `--max-requests` |
| Completion tokens per request | 16,384, further limited by effort | 16,384 | `--max-tokens` |
| Reserved completion tokens for the run | 131,072 | 196,608 | `--max-total-tokens` |
| Input characters per request | 100,000 | 150,000 | `--max-input-characters` |
| Total input characters | 800,000 | 1,000,000 | `--max-total-input-characters` |
| Request duration | 240,000 ms, further limited by effort | 240,000 ms | `--timeout-ms` |
| Run duration | 1,800,000 ms | 1,800,000 ms | `--max-duration-ms` |

The complete completion allowance is reserved before each request, including a failed request. Requests are sequential, with no automatic retries. A failed turn skips its dependent follow-ups; two consecutive provider failures stop the remaining run. Budget exhaustion marks later turns as skipped and produces a nonzero exit. Pressing Ctrl+C cancels the active request and records skipped remaining turns when report writing can complete. Public answers also have a fixed 24,000-character collection limit.

Reserved tokens are a conservative request budget, **not measured usage or a currency estimate**. Provider completion accounting can include reasoning. Input is bounded in characters rather than exact tokens. Provider billing and tokenizer behavior are outside this harness, and canceled requests may still incur charges. A provider could spend on private reasoning without producing any public answer. The harness saves only public `delta.content`, never `reasoning_content` or other internal reasoning.

## What the ten turns cover

| Conversation ID | Turns | Main checks |
| --- | ---: | --- |
| `handbook-reference` | 1 | Provided Handbook working days, start/end time, one-hour lunch, citation and current-status qualification |
| `confirmation-reasoning` | 1 | Twelve months alone do not satisfy the separate reporting and written confirmation conditions |
| `short-followups` | 3 | Fixed probation MCQ, grading a one-letter answer, interpreting “Why?” using prior context and evidence |
| `primary-spectrum-and-topic-switch` | 2 | ITU allocation versus station assignment; then 240 × 0.85 × 1.10 = 224.40 and a 6.5% net reduction |
| `primary-qos-false-premise` | 1 | Correct the claim that QoS excludes user satisfaction, with the checked ITU appendix |
| `unsupported-current-statistic` | 1 | Decline to invent an official subscriber count for a future date |
| `adversarial-handbook-premise` | 1 | Reject a false three-month probation premise and a requested fabricated citation |

Reference fixtures pin the supplied handbook's source-file hash, stable passage IDs and expected text. The ITU supplement fixtures pin the **checked excerpt hash**, not a full PDF hash. `primary-source-checked` describes the verification provenance; status `VERIFY` and currency notes remain separate. A checked 2015 or 2019 reference does not establish a current Nigerian policy or threshold. Reports include source URLs and provenance when retrieval supplies them.

The fixture text and hashes must match before the harness sends a request for that conversation. A change requires re-reading and reviewing the source rather than updating an expected hash merely to make the check pass. Fixed numeric/reference facts are authored independently of generated responses. For source-specific cases, the answer must cite one of the expected retrieved references; all bracketed citations must belong to the current turn's retrieved set. Citation membership alone does not establish that the cited passage supports the sentence.

## Review the report

For each answer, check the full conclusion, calculations, omitted conditions, relevant uncertainty and whether citations actually support the claims. Verify that an answer does not agree with a false premise while also mentioning the correct fact. For short replies, confirm it responds to the preceding question. For the topic switch, confirm the earlier regulatory topic is not forced into the general calculation. The unsupported-statistic check cannot detect every number expressed in words or every invented publication; manual review remains necessary.

The report stores the raw public answer before the application's citation-warning notice. A warning appended by the app therefore cannot cause an unsupported-evidence test to pass. Reports retain selected reasoning effort and fixed classifier reason codes, not the model's internal reasoning. Request headers and environment objects are never serialized. Known secret values, common bearer/key formats and URL credentials are scrubbed from report fields and fatal error output.

Record the model, corpus/policy hashes and full bounds when comparing runs. The reports include those reproduction details, but model sampling and hosted provider revisions can still change results. Dry-run retrieval history is simulated; only a live run tests actual multi-turn model behavior. If changing a check after a run, keep the original result and explain the false positive/negative instead of silently replacing a failure with a pass.

This harness deliberately starts with an empty saved learning record and does not write to the study database. It covers the shared model pipeline, but not HTTP authentication, session persistence, retries/idempotency, browser rendering, voice or exam grading. Those have separate integration and browser tests. Passing this harness does not replace those checks.
