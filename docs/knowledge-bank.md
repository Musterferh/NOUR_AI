# Knowledge bank, retrieval, and source maintenance

## What runs in production

`src/lib/pdf-pipeline.ts` loads `data/knowledge-bank.json` when it exists, otherwise `data/embeddings.json`. A valid index is cached once per server process. Restart or redeploy after replacing the corpus. Failed loads are not cached, so restoring the files allows a later request to recover.

`src/lib/knowledge-retrieval.ts` implements BM25 over Unicode-normalized words. Common question words are removed, a small controlled list expands acronyms, and conservative spelling/plural normalization handles forms such as licence/licensing. Query and document terms share the same representation. The old stored neural vectors are ignored; there is no embedding-model download or paid embedding request.

The ranker requires meaningful query-term coverage before returning a source. A category can modestly influence ranking, but it cannot make an unrelated substantive request match. BM25 is a lexical baseline, so paraphrases with no shared vocabulary may still produce no result. The coverage threshold is an explicit heuristic, not a probability of answer correctness.

Follow-ups such as `A`, `B because…`, `Why?`, and `Explain that` can reuse source IDs from the active question. Only IDs present in the loaded corpus are accepted. Otherwise the last substantive learner topic and active category establish the query. A new `Quiz me` respects the selected category. A substantive new request is searched independently, even if the caller supplies old source IDs.

General drills and exams take sources from six syllabus areas: NCA objectives, spectrum, QoS/QoE, NIN-SIM/TIRMS, emerging technology, and governance. This provides topic coverage without using the word “General” as a content query.

## Server contracts

```ts
retrieveContext({
  query: string,
  category?: string,
  history?: Array<{ role: string; content: string }>,
  sourceIds?: string[],
  maxChunks?: number, // default 6, capped at 12
}): Promise<{
  context: string,
  sources: Array<{
    id: string,
    title: string,
    section?: string,
    page?: number,
    status: string,
    excerpt: string,
  }>,
  quality: 'matched' | 'none',
}>
```

`retrieveContextForTopics(request, topics)` returns the same shape. It retrieves up to five weak topics separately, then selects unique source IDs in rounds under the total chunk cap. Use it for personalized revision and exams instead of joining unrelated weak areas into one long query. Empty topics use the normal request; unsupported topics do not receive invented evidence.

`quality: 'none'` means `context` is empty and `sources` is an empty array. The caller should explain the evidence gap instead of asking the model to improvise. An absent, unreadable, malformed, duplicate-ID, or checksum-invalid corpus throws `KnowledgeBaseError` with code `KNOWLEDGE_BASE_UNAVAILABLE`. An invalid preferred new corpus does not silently fall back to older material.

The legacy `getRelevantContext(query, maxChunks)` returns only the context string and propagates source-load failures. New callers should use the structured contracts so citations and abstention are explicit.

## What the existing corpus can establish

The committed legacy artifact contains 291 chunks and 384-dimensional vectors. The original source PDF is absent from this checkout. The generator that produced the artifact did not record its PDF checksum, extraction time, or independently verified source version. `data/knowledge-manifest.json` records the checksum of the **extracted JSON**, with the unavailable original-source fields set to `null`.

These gaps are not filled with the PDF filename that the old script expected, the date in a persona prompt, or an inferred publication date. None of those proves which source bytes produced this corpus. The legacy manifest is an inventory record; runtime source validation checks the corpus structure, while newly generated corpora also carry a verified content checksum.

Old metadata labels are not treated as evidence. At runtime:

- Chapter/section labels come from `DEEP CHAPTER` or `Checkpoint` strings actually present in the chunk.
- A legacy page number is supplied only when the text contains one unambiguous explicit `Page N` value. Multi-page chunks have no single page citation. No section or page is fabricated when absent.
- Source excerpts are exact substrings of stored source content.
- Every legacy source receives `VERIFY`; the old value `Active` is not a controlled regulatory status.
- Source version and independent baseline are marked unknown. A source-level status does not establish the status of every claim inside it.

The corpus includes later correction and currency appendices that can disagree with earlier chapters. Retrieval modestly prefers matching correction appendices, but that does not automatically resolve factual conflicts. Model instructions must separate evidence, acknowledge conflicting statuses, and avoid hard-coded assertions about which instrument is currently operative. A source ID proves which text was retrieved, not that its claims remain current.

## Rebuild from a controlled PDF

Install the project dependencies first (`npm ci`). Obtain the source PDF from its owner and establish its version and checksum. No source download is built into the application.

For PowerShell, replace the paths and version with the actual artifact. This executable example calculates the local file checksum; if the publisher supplies an independently confirmed checksum, use that value instead:

```powershell
$knowledgePdf = 'C:\sources\knowledge-bank.pdf'
$knowledgeHash = (Get-FileHash -LiteralPath $knowledgePdf -Algorithm SHA256).Hash.ToLowerInvariant()
npm run knowledge:build -- --input $knowledgePdf --version 'publisher-version-here' --sha256 $knowledgeHash --title 'NCC controlled study bank'
```

If the document explicitly establishes a baseline, append `--baseline YYYY-MM-DD` with its actual date. Do not copy a date from the coaching prompt. `--output` defaults to `data/knowledge-bank.json`; a custom output is useful for reviewing a candidate corpus before replacing the deployed artifact.

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

The historical script name is retained for compatibility; it now builds a lexical knowledge bank. `--input` and `--version` are required. Invalid arguments, impossible dates, invalid status values, and mismatched expected checksums fail before writing the output. Output is written to a temporary sibling file and renamed after generation succeeds.

Status defaults to `VERIFY`. Accepted values are `CURRENT`, `IMPLEMENTED`, `ACHIEVEMENT`, `INITIATIVE`, `CONSULTATION`, `DRAFT`, `HISTORICAL`, `OBSERVED`, and `VERIFY`. Only supply a different source status when review supports it for the entire imported source. A mixed document should normally remain `VERIFY` and preserve claim-specific labels in its text.

## Extraction and generated provenance

The importer uses the installed direct `pdfjs-dist` dependency. It preserves text-item line breaks, carries detected section headings, and keeps each chunk within one actual PDF page and one detected section. Long sections use 320-word windows with a 35-word overlap. The generated page numbers are PDF page positions, which may differ from printed pagination.

Every new chunk records its stable source-derived ID, source title, source filename, source SHA-256, supplied version, optional source baseline, page, section when found, and controlled source status. The envelope records schema version, generation time, generator version, algorithm name, page count, empty-page inventory, chunk count, and a checksum of the serialized chunks. Startup rejects a new envelope when that content checksum does not match.

The importer does not perform OCR, interpret figures, or guarantee correct reading order for complex tables and columns. An entirely textless PDF fails with an OCR instruction; individual empty pages are reported for review. Check the original pages for diagrams, scanned text, superscripts, tables, and corrections before publishing the generated corpus.

## Evaluation and release review

Run the focused retrieval and ingestion suite:

```powershell
node --import tsx --test tests/retrieval.test.ts tests/knowledge-ingest.test.ts
```

Run the complete application suite with `npm test`. The focused cases cover:

- Reviewed source IDs for spectrum distinctions, number portability, QoS/QoE, DND, TIRMS, NCA objectives, and memo structure.
- Retrieval for every supported study category and breadth for a General exam.
- Quiz initiation, category changes, short replies, pinned source IDs, and independent weak topics.
- Abstention for unsupported requests, including requests phrased as follow-ups.
- Honest legacy sections/pages/status, typed load failures, duplicate IDs, and invalid content checksums.
- Ingestion page/section boundaries, overlap, empty scans, and CLI argument validation.

The source-ID expectations are pinned to the reviewed committed corpus. A new PDF produces new IDs, so a corpus update requires reviewing the corresponding source passages and deliberately updating the evaluation fixtures. Do not remove failing expectations merely to accept a new artifact. Extend the cases when a real question exposes a retrieval gap.

These are deterministic retrieval and ingestion tests. They do not establish the factual accuracy of every source, the accuracy of all generated answers, or a measured semantic-retrieval benchmark. Before release, review source currency and conflicts, test model answers against reviewed examples, inspect rendered citations, and confirm unavailable evidence leads to an explicit limitation. Keep the previous controlled artifact available for rollback and restart the application to load the selected version.
