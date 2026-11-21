# Changelog

## 0.3.0 · 2026-11-21

- **@hilvana/core**: `inspect()` reports `signatures` (digital signatures in the file). Changed files no longer carry broken signatures: a signature covers exact bytes, so after any change readers would show it as tampered. Its visible appearance stays on the page. New `countSignatures()` and `dropSignatures()`.
- **@hilvana/recipes**: plans and runs warn when an input is digitally signed (`SIGNED_INPUT`, Spanish and English).
- **hilvana**: `inspect` shows the signature count; commands that change a signed PDF warn on stderr.
- **hilvana-mcp**: `pdf_inspect` returns `signatures`; `recipe_plan` and `recipe_run` include the warning.
- **Web**: signed files are flagged in the file list and in the result. New third-party notices file (`THIRD_PARTY_NOTICES.txt`), linked from the footer, with the license of every bundled package, font and pdf.js data file.

## 0.2.0 · 2026-11-21

- **@hilvana/recipes**: new `split` step (last step only) that produces one file per range, or per page. `RunResult.outputs` lists every file; `bytes`/`filename` stay as the first output for existing callers. `Plan.outputCount` predicts how many files a recipe makes.
- **hilvana** (`run`) and **hilvana-mcp** (`recipe_run`): recipes that split write their parts into a folder. The MCP server checks every destination before writing any part.
- **Web**: every tool now runs a recipe and shows it, including Split and Word batches.

- **hilvana**, **hilvana-mcp**: `--version` (and the version the MCP server reports to clients) is read from the package, so it can no longer drift from the release. 0.1.1 reported 0.1.0. (D24)

## 0.1.1 · 2026-11-21

Fixes found by the risk-based QA pass of phase 1 ([docs/qa/fase-1-web.md](docs/qa/fase-1-web.md)).

- **@hilvana/core**
  - Compressing PDFs with images works in browsers (`jpeg-js` needed Node's `Buffer`). (D22)
  - Encrypted PDFs are reported as protected (`ENCRYPTED`) instead of invalid, including permission-only files. (D17)
- **@hilvana/office**
  - Word files can no longer expand without limit in memory ("zip bombs"): only the parts the converter reads are extracted, with per-part and total caps, and parts that hide their real size are refused (`DOCX_TOO_LARGE`, `DOCX_LIMITS`). (D15)
  - Damaged XML inside a .docx is reported as `CORRUPT_DOCX` instead of a raw parser error. (D21)
- **@hilvana/recipes**: messages for `DOCX_TOO_LARGE` and a clearer `ENCRYPTED` message, in Spanish and English.

## 0.1.0 · 2026-11-20

First public release: PDF engine, Word → PDF, recipes, CLI (`hilvana`) and MCP server (`hilvana-mcp`).
