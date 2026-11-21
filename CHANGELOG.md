# Changelog

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
