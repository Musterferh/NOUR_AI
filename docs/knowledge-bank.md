# Knowledge bank, retrieval, and source maintenance

## Active corpus and loading

`src/lib/pdf-pipeline.ts` prefers `data/knowledge-bank.json`; only an absent file falls back to `data/embeddings.json`. It then appends the optional, separately reviewed `data/verified-materials.json`. It does not independently load the two component PDF banks when the merged bank is present, so their chunks are not duplicated.

As reviewed on 2026-09-24, the active index contains **1,426 chunks**:

| Artifact | Contents | Runtime provenance |
| --- | --- | --- |
| `knowledge-bank.json` | Merged envelope: 291 legacy + 860 study-guide + 271 handbook chunks | Determined per chunk, not from the envelope |
| `embeddings.json` | Original 291 legacy chunks; old vectors ignored | `unverified` |
| `bank-ncc-study-guide.json` | 860 chunks from 357 PDF pages, included in the merged bank | `provided-document` |
| `bank-employee-handbook.json` | 271 chunks from 76 PDF pages, included in the merged bank | `provided-document` |
| `verified-materials.json` | Four small reviewed primary-source summaries and exact excerpts | `primary-source-checked` |

The supplied study-guide PDF hash is `0fc2e67c2710786c7bd2c3c32943631ea783d849278ddd84c9accbde227a7e1d`, version `restructured-master-v1`. The supplied handbook PDF hash is `29055b51b186a7b1b6f341d37487c66603ee095c96f97e04aaef646e9b4b4075`, version `employee-handbook-v1`. The component envelopes record these extraction inputs; the source PDFs themselves are absent from this checkout. Those records establish what the importer was told and hashed, not independent publisher authority or current policy.

A successful index is cached per server process. Restart or redeploy after replacing a corpus. Failed loads are not cached. Absent, unreadable, empty, malformed, duplicate-ID, or checksum-invalid banks raise `KnowledgeBaseError` (`KNOWLEDGE_BASE_UNAVAILABLE`). An invalid preferred bank or an invalid present supplement fails closed; it is not silently replaced with older material. Next's output tracing includes `data/*.json` for API routes.

## Source provenance is separate from currency

Every runtime source currently has status **`VERIFY`**. Primary-source checking means the publisher URL, cited page, excerpt and authored summary were reviewed. It does not establish that an instrument is operative today, that an old contact number still works, or that every assertion in the rest of the corpus is correct.

Imported source statuses such as `Active` or `CURRENT` cannot certify themselves. The loader normalizes all base-bank chunks to `VERIFY`, strips self-declared primary review dates and excerpt hashes, and assigns `unverified` or `provided-document`. This also applies to legacy chunks inside the merged envelope. A checksum of a merged JSON file does not restore missing original provenance.

For the legacy material, chapter/section labels come only from literal `DEEP CHAPTER` or `Checkpoint` headings in its text. A page citation is recovered only from one unambiguous `Page N` marker; multi-page chunks receive no single page. The version is unknown. `knowledge-manifest.json` inventories the legacy extracted artifact and explicitly leaves unavailable original-source fields unknown.

The supplied PDF banks retain their extraction page, filename, hash and version. Runtime repairs section metadata when decimal headings actually visible in the body contradict inherited labels. Chunks with several headings or a substantial preceding continuation are explicitly labeled as mixed/continued sections; illegible numbers are never reconstructed from guesses. A conflicting chapter label becomes unknown. For example, handbook PDF page 13 contains a visible section 1.4 heading and earlier policy text, so its inherited section 1.2.4 label is discarded without inventing an unreadable section number. Page numbers are PDF positions, not necessarily printed page labels. Text extraction can still misread headings, columns and tables; a provided-document badge does not correct every OCR problem. Correction appendices may contradict earlier passages; the model must acknowledge conflicting evidence and separate source statements from its explanations.

## Four bounded primary-source additions

The supplement was checked on **2026-09-24**. It preserves a short exact excerpt (whitespace normalized, at most 25 words per source), a concise authored summary, publisher URL, actual PDF page, publication date only when established, review date, excerpt SHA-256 and a specific currency limitation.

| Source ID | Publisher material and checked scope | PDF page / date |
| --- | --- | --- |
| `primary-itu-spectrum-2015` | [ITU NTFA guidelines, section 2.2.2](https://www.itu.int/en/ITU-D/Spectrum-Broadcasting/Documents/Publications/Guidelines-NTFA-E.pdf): allocation, allotment and assignment; an allocation alone is not station permission | Excerpt p10; definitions pp9-10; 2015 |
| `primary-itu-qos-qoe-2019` | [ITU-T G.1033, Appendix II.1](https://www.itu.int/rec/dologin_pub.asp?id=T-REC-G.1033-201910-I%21%21PDF-E&lang=e&type=items): QoS includes user satisfaction and non-technical aspects; QoE emphasizes user assessment | p25 (printed p19); 2019-10 |
| `primary-ncc-nca-objectives-2003` | [NCC-hosted Nigerian Communications Act, section 1](https://www.ncc.gov.ng/media/1362/view): stated objectives in the 2003 text | p9 (printed A293); 2003 edition, Act dated 8 July |
| `primary-ncc-consumer-redress-faq` | [NCC data-usage FAQ, question 31](https://www.ncc.gov.ng/sites/default/files/2024-11/Documents/consumer-affairs/CAB-FAQ_on_Data_Usage.pdf): provider complaint, trouble ticket and escalation | p15; publication date unknown |

The ITU appendix is explanatory and is not an integral part of its recommendation. No current Nigerian QoS threshold or band authorization was checked. The NCC-hosted Act was not consolidated against later amendments. The FAQ refers to the COVID-19 period; its `2024-11` upload path is **not** treated as a publication date, and its old contact numbers are not reproduced as current guidance.

`excerptHash` is SHA-256 of the exact UTF-8 excerpt string, not the publisher PDF bytes. The envelope checksum covers `JSON.stringify(chunks)`. These hashes detect artifact changes; they are not signatures proving publisher authenticity or an automated web recheck. The runtime does not fetch these URLs.

Only this maintained supplement grants `primary-source-checked`. It requires HTTPS NCC/ITU hostnames, valid review dates, real page/section fields, an excerpt present in the stored passage, a matching excerpt hash, `VERIFY`, and the envelope checksum. Duplicate IDs across the base bank and supplement are rejected. Adding another publisher requires extending the host validation after reviewing that source.

## Retrieval and follow-ups

`src/lib/knowledge-retrieval.ts` uses BM25 over Unicode-normalized words with controlled acronym expansion and grammatical normalization (for example licence/licensing and authorise/authorisation). There are no paid embedding calls, vector-model downloads or comparisons between incompatible embedding spaces.

The ranker requires meaningful query-term coverage before a document can match. Output instructions such as word limits, citation requests and requests not to invent facts are excluded from the content query; a controlled list removes generic reasoning instructions. Substantive topic words are retained. Matching checked sources receive a modest preference **after** the coverage gate. A category or provenance badge cannot rescue an unrelated source.

When a question explicitly names a loaded document, retrieval scopes results to that document. Long scenarios and false-premise questions can also match a specific, uncommon subject term in a literal section heading and the passage itself. This prevents a wrong asserted duration or long formatting instructions from hiding the correct probation section. A title or page number alone is insufficient. Tests require unrelated medical and biology questions to abstain even when they name the Employee Handbook.

`A`, `B because ...`, `Why?`, `Compare those`, `How do they differ?`, and polite brief explanations can reuse real source IDs from the active question. Unknown IDs are ignored. Without retained IDs, retrieval uses the previous substantive user topic, active category, or prior coach question. A topic-bearing follow-up such as `What about assignment?` searches its new terms and uses prior context only to disambiguate matches. `What about photosynthesis?` does not inherit spectrum evidence. Comparisons whose other subject has no corpus evidence abstain.

A new `Quiz me` respects the selected category. General drills sample six syllabus areas: NCA objectives, spectrum, QoS/QoE, NIN-SIM/TIRMS, emerging technology, and governance. Personalized revision queries each weak topic independently and interleaves results instead of requiring every unrelated topic in a single passage.

This is a deterministic lexical baseline, not a semantic understanding guarantee. Novel paraphrases, long mixed-domain requests, typos and multiple simultaneous questions can still miss relevant evidence or return only partial evidence. `matched` means there is matching text, not that every premise or requested current fact is supported. The answer policy must identify evidence gaps and avoid treating source presence as proof of every claim.

## Server contract

```ts
retrieveContext({
  query: string,
  category?: string,
  history?: Array<{ role: string; content: string }>,
  sourceIds?: string[],
  maxChunks?: number, // default 6; maximum 12
}): Promise<{
  context: string,
  sources: Array<{
    id: string,
    title: string,
    section?: string,
    page?: number,
    status: string,
    excerpt: string,
    url?: string,
    publisher?: string,
    publishedDate?: string, // known precision: YYYY, YYYY-MM, or YYYY-MM-DD
    verifiedAt?: string, // primary provenance review, NOT effective legal date
    provenance?: 'primary-source-checked' | 'provided-document' | 'unverified',
    currencyNote?: string,
    excerptHash?: string,
  }>,
  quality: 'matched' | 'none',
}>
```

`retrieveContextForTopics(request, topics)` has the same result shape and queries at most five topics independently. Empty topics use ordinary retrieval. `quality: 'none'` returns empty context and sources. Load failures throw the typed error. The legacy `getRelevantContext(query, maxChunks)` returns only the string and propagates load failures.

Base-bank excerpts are substrings of retrieved stored content; checked sources expose the reviewed exact excerpt. Model context includes full selected passage content and explicit provenance/currency limitations. Citations must use returned IDs; an ID alone is not a verification badge.

## Rebuild a supplied PDF bank

Install dependencies with `npm ci`. Obtain the PDF from its owner and establish its version. This PowerShell example computes the local checksum; use an independently confirmed publisher checksum instead when available:

```powershell
$knowledgePdf = 'C:\sources\knowledge-bank.pdf'
$knowledgeHash = (Get-FileHash -LiteralPath $knowledgePdf -Algorithm SHA256).Hash.ToLowerInvariant()
npm run knowledge:build -- --input $knowledgePdf --version 'publisher-version-here' --sha256 $knowledgeHash --title 'NCC controlled study bank' --output 'data/candidate-bank.json'
```

Review the candidate before replacing or merging the active bank. Do not overwrite the user-provided component banks or checked supplement to rebuild one document. Preserve IDs and provenance from each input; reject duplicates and recompute the merged `manifest.contentSha256` over the serialized chunks. Keep the previous active artifact for rollback.

The complete CLI is:

```text
node scripts/generate-embeddings.mjs
  --input <PDF path>
  --version <source version>
  [--title <display title>]
  [--baseline <YYYY-MM-DD>]
  [--sha256 <expected 64-character SHA-256>]
  [--output <JSON path>]
  [--status <controlled source status>]
```

`--input` and `--version` are required. `--output` defaults to `data/knowledge-bank.json`. Only supply a baseline date established by the actual source; a persona prompt date is not evidence. Invalid arguments, dates, statuses and expected-checksum mismatches fail before output replacement. Generation writes to a temporary sibling and renames it after success.

Status defaults to `VERIFY`. Accepted artifact values remain `CURRENT`, `IMPLEMENTED`, `ACHIEVEMENT`, `INITIATIVE`, `CONSULTATION`, `DRAFT`, `HISTORICAL`, `OBSERVED`, and `VERIFY`. The supplied value is preserved **in the generated artifact**, but runtime still marks uncontrolled imports `VERIFY`; a CLI flag cannot certify their authority or present applicability.

The historical script name is retained. Its direct `pdfjs-dist` dependency extracts page text without embeddings. Each chunk stays within one actual PDF page and detected section; long sections use 320-word windows and a 35-word overlap. Generated metadata records the source filename/hash/version, supplied baseline, PDF page, detected section, generator version, timestamp, page count, empty pages, chunk count and serialized-content checksum.

There is no OCR or interpretation of figures. Entirely textless PDFs fail with an OCR instruction; individual empty pages are recorded for review. Inspect diagrams, scans, tables, superscripts, reading order and correction appendices in the original document before publishing a new corpus.

## Maintaining checked excerpts

Review the exact publisher page and the surrounding passage before adding a short summary. Preserve actual publication-date precision; use no date when unknown. Record the real PDF position and any differing printed label. Explicitly separate provenance checking from regulatory currency. Use a stable new source ID and retain `VERIFY` when no current legal-status review has been performed.

After editing reviewed passages, recompute each `metadata.excerptHash` from its `metadata.exactExcerpt`, then the envelope's `manifest.contentSha256` from `JSON.stringify(chunks)`. Check that excerpts remain exact, limited in length and present in the stored content. Update the reviewed test fixtures deliberately when passages or hashes change. Recomputing a hash is not itself source review.

## Evaluation and release checks

Focused deterministic retrieval and ingestion tests:

```powershell
node --import tsx --test tests/retrieval.test.ts tests/knowledge-ingest.test.ts
```

The cases cover all supported categories, representative legacy source IDs, independent weak topics, real PDF extraction and failure preservation, all four checked sources, mixed-bank normalization, forged provenance, excerpt/URL/date validation, duplicate IDs, short and polite follow-ups, new-topic abstention, and full natural-language reasoning prompts with output constraints. The spectrum/QoS cases require the reviewed primary passages; the handbook case requires the correct provided document passage. Corpus changes require reviewing and deliberately updating source expectations, not discarding failed assertions.

Run `npm test` for the complete application suite. The conversation harness supports an offline planning check:

```powershell
node --import tsx scripts/evaluate-conversation.ts --dry-run
```

The live evaluation command and request/token bounds are documented in [the evaluation guide](conversation-evaluation.md). Live evaluation uses the model API and is separate from deterministic retrieval tests. Passing source selection does not certify generated answers or the whole bank. Review actual answers for correctness, reasoning, citation support, handling of false premises, current-status limitations and topic changes. Restart the application after corpus changes and inspect rendered source links.
