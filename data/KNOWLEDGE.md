# Knowledge bank maintenance

See [docs/knowledge-bank.md](../docs/knowledge-bank.md) for source provenance, API fields, exact rebuild commands and evaluation procedures.

The active index has **1,426 chunks**: `knowledge-bank.json` contains the original 291 legacy chunks plus the supplied 860-chunk study guide and 271-chunk employee handbook; `verified-materials.json` adds four small primary-source passages. The component banks are preserved. The loader uses the merged bank when present, otherwise `embeddings.json`, and then appends the separate supplement. It does not load the component banks twice.

Runtime provenance has three values:

- `unverified`: legacy text with unknown original PDF/version. Headings and page markers are recovered conservatively from the text.
- `provided-document`: extracted PDF material with recorded source hash/version/pages. That records provenance supplied during ingestion, not independent authority or currency.
- `primary-source-checked`: only the four reviewed NCC/ITU excerpts in the separate supplement, with publisher URLs, real pages, exact excerpt hashes and review dates.

**All runtime source statuses remain `VERIFY`.** Checking a publisher passage does not establish current law or policy. Base-bank labels cannot self-certify as current or checked. The source PDFs underlying the existing supplied banks are not included in this checkout.

The supplement was reviewed on 2026-09-24 and covers ITU spectrum allocation/allotment/assignment (2015), ITU QoS/QoE nuance (2019), NCC-hosted NCA section 1 (2003), and NCC consumer complaint escalation (undated FAQ). Its metadata gives the precise source URLs and limitations. Excerpt hashes cover excerpt strings, not the full publisher PDFs. The FAQ upload directory is not treated as a publication date. No entire existing bank was marked verified.

Retrieval uses BM25 and controlled terminology; old vectors are ignored. Long questions exclude bounded output instructions from scoring. Explicitly named documents constrain search, and their literal subject headings help retrieve evidence for long scenarios and false premises. Short referential replies can retain real source IDs, while new topic terms must match evidence. Matching checked passages receive a modest preference. Runtime corrects demonstrably inherited section labels using visible headings and marks mixed sections without guessing illegible numbers. No embedding download or paid API call occurs during retrieval or ingestion.

To build a review candidate without overwriting the active or component banks:

```powershell
$knowledgePdf = 'C:\sources\knowledge-bank.pdf'
$knowledgeHash = (Get-FileHash -LiteralPath $knowledgePdf -Algorithm SHA256).Hash.ToLowerInvariant()
npm run knowledge:build -- --input $knowledgePdf --version 'actual-source-version' --sha256 $knowledgeHash --output 'data/candidate-bank.json'
```

Use the actual source version. Add `--baseline YYYY-MM-DD` only when the source establishes that date. `--title` is optional. The default output, if `--output` is omitted, is `data/knowledge-bank.json`. A supplied `--status` remains an artifact label; runtime still requires verification. Scans need OCR, and tables/figures require review against original pages.

Checksum-invalid or malformed banks fail with a typed knowledge-bank error, including invalid present supplements. Restart/redeploy after replacing the corpus because successful indexes are cached. Keep prior artifacts for rollback.

Run focused checks with:

```powershell
node --import tsx --test tests/retrieval.test.ts tests/knowledge-ingest.test.ts
```

Run `npm test` for the complete suite and `node --import tsx scripts/evaluate-conversation.ts --dry-run` to check the conversation evaluation plan without model calls. Test success establishes only the specific checked behavior; it does not certify every fact, current status or generated answer.
