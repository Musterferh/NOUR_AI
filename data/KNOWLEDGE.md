# Knowledge bank maintenance

The complete maintenance guide, API contracts, rebuild options, provenance limits, and evaluation procedure are in [docs/knowledge-bank.md](../docs/knowledge-bank.md).

The application uses BM25 lexical retrieval, with acronym expansion, conversation topic continuity, and source references. It does not compare hash vectors with model embeddings. The existing `embeddings.json` remains supported as a legacy input; its vector fields are ignored.

The original PDF is not included in this checkout. Its version, checksum, and extraction date cannot be reconstructed from the legacy JSON. The legacy manifest records this gap. Existing labels are recovered conservatively from headings and explicit page markers in the text; mixed-page chunks have no single page citation. Legacy source status is `VERIFY`, not a claim that any individual fact has been independently checked.

To rebuild, obtain the controlled source PDF from its owner, record its version and independently confirmed checksum, and run:

```powershell
node scripts/generate-embeddings.mjs --input "C:\sources\knowledge-bank.pdf" --version "controlled-v7" --baseline "2026-08-17" --sha256 "<64-character-source-sha256>"
```

Use the source's actual version and baseline, not the example values. Omit `--baseline` if the source does not establish one. `--title` and `--output` are optional. The historical script name is retained, but no embedding model is downloaded or invoked. A direct `pdfjs-dist` dependency extracts text. Scanned pages need OCR before ingestion, and diagrams/tables still require visual source review.

The default output is `data/knowledge-bank.json`. It includes the source checksum, file name, supplied version, optional baseline, parser page numbers, section headings, chunk-content checksum, generation time, and generator version. New chunks never cross PDF pages or detected section boundaries. Status defaults to `VERIFY`; only use `--status` after review establishes that status for the entire source. Status of individual factual claims must still be taken from their text.

The application prefers the new file when present and otherwise loads the legacy corpus. An invalid new file causes a knowledge-bank error rather than silently serving the old material. Restart the application after replacing a corpus, since successful indexes are cached per server process.

Run `npm test` after rebuilding. Retrieval tests cover representative bank questions, category-aware drills, short answers, pinned evidence, abstention, honest legacy metadata, and invalid corpus failures. Passing retrieval tests demonstrates source selection for those cases; it does not certify the factual accuracy of the entire bank or generated answers. Review currency corrections and conflicts before publishing any new baseline.
