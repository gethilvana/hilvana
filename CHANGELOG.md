# Changelog

## 0.5.1 · 2026-11-22

- **@hilvana/core**: signing a PDF that is both protected and already signed (like bank statements that are signed and restricted) no longer drops its earlier signatures. The document is signed as it is, encryption included, so the earlier signatures stay valid and the protection is kept (`CertificateSignResult.protection`); `openPassword` opens one that needs a password. This works around an issue in `@libpdf/core` 0.5 that rewrote objects read from encrypted files, re-encrypting earlier signature values and adding a revision after the new signature. The decryption library's false alarms about signature values no longer reach the console.
- **@hilvana/recipes**: in that case the plan says the protection is kept (`PROTECTION_KEPT`) instead of saying it is removed, and the goals are checked by opening the result with the input's password.
- **hilvana** (`certify`) and **Web** (*Firma digital*): same behavior; the web file row says the protection is kept.

## 0.5.0 · 2026-11-21

- **@hilvana/core**: `protect(bytes, opts)` encrypts with AES-256, with a password to open and/or usage restrictions (print, copy, modify). `signWithCertificate(bytes, opts)` signs with a `.p12`/`.pfx` certificate (RSA or elliptic curve, legacy `.pfx` included), PAdES B-B, entirely on the device: no time-stamping server. It appends the signature without rewriting the file, so earlier signatures stay valid, and draws an optional visible line only on documents with no signatures yet. `readCertificate()` describes who signs, the issuer and the validity. New error codes `INVALID_CERTIFICATE`, `WRONG_CERTIFICATE_PASSWORD`, `CERTIFICATE_EXPIRED`, `CERTIFICATE_NOT_YET_VALID`. Signatures are checked in tests with Poppler's `pdfsig`, an independent validator.
- **@hilvana/recipes**: new last-only steps `protect` and `signDigital`; a recipe can end with at most one of `split`, `protect` and `signDigital` (`FINAL_NOT_LAST`). Certificates are inputs named `.p12`/`.pfx`, with their password in `InputFile.password`. `plan()` opens the certificate and returns `signer`, warns about self-signed certificates and rejects expired ones. A recipe with only `signDigital` on one PDF signs it as is (`SIGNATURES_KEPT`). Results protected with a password are opened with it only to check the goals. New `redactRecipe()` and `SECRET_OPS`.
- **hilvana**: `protect` (`--restrict print,copy,modify`; the new password is asked for, or read from `HILVANA_NEW_PASSWORD`) and `certify` (`--cert`, `--reason`, `--location`, `--invisible`, `--pages`, `--anchor`; the certificate password is asked for, or read from `HILVANA_CERT_PASSWORD`). In `run`, `.p12`/`.pfx` inputs use that password.
- **hilvana-mcp**: refuses recipes that need a secret (`signDigital`, `protect` with a password) with `SECRET_NOT_ALLOWED` and a pointer to the web app and the CLI. Restriction-only `protect` is allowed.
- **Web**: new tools *Firma digital* (choose a certificate, see who signs before signing) and *Proteger con contraseña* (password typed twice, permissions). The certificate, its key and passwords stay in the page's memory and are forgotten when leaving the tool; the recipe shown never contains a password. The group is now *Reducir y proteger*.
- **CI**: installs Poppler so signature checks run (and are required) on Linux.

## 0.4.0 · 2026-11-21

- **@hilvana/core**: new `unlock(bytes, password?)`. PDFs with only usage restrictions (no password to open, like many bank statements) are unlocked automatically by `load()` and `inspect()`; PDFs that need a password open with it. RC4 (40/128), AES-128 and AES-256 are supported, through `@libpdf/core` (MIT), loaded only when a file is encrypted. New error codes `PASSWORD_REQUIRED` and `WRONG_PASSWORD`; `ENCRYPTED` now means an unsupported scheme (for example certificate-based). `PdfInfo.protection` says how the file was protected.
- **@hilvana/recipes**: `InputFile.password`; plans warn when restrictions or a password were removed (`UNLOCKED_PERMISSIONS`, `UNLOCKED_PASSWORD`).
- **hilvana**: `--password` (or `HILVANA_PDF_PASSWORD`, kept out of shell history); `inspect` shows the kind of protection.
- **hilvana-mcp**: opens files with only restrictions. It never takes passwords: when a file needs one, it tells the agent how the person can open it themselves.
- **Web**: protected files open on their own or with a password typed in the file row, in the browser only.

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
