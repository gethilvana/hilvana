# Changelog

## 0.9.0 · 2026-11-22

- **Public benchmark** (`npm run bench`, [docs/benchmark.md](docs/benchmark.md)). It runs on 130 Word documents from Apache POI and 200 real-world PDFs from pdf.js, both fetched at pinned commits with SHA-256 checksums. It adds 12 synthetic Spanish statements, invoices and letters scanned under 5 conditions, with their exact text. Native Tesseract, LibreOffice and qpdf serve as local references. It measures OCR, redaction, Word conversion, operations on real PDFs and compression.
- Fixes found by the benchmark, each with a test:
  - **@hilvana/core**: the `email` pattern finds addresses as OCR mangles them ("@" read as "(D", "0", "Q", "O" or dropped). A name term also catches user names and addresses built from it (`ana.perez`, `ana.64`). Page resources stored as a stream, or broken font entries, no longer make operations fail. `PdfInfo.missingPages` reports pages a damaged file declares but cannot be read, and plans warn about it (`MISSING_PAGES`).
  - **@hilvana/office**: the OCR text layer keeps every word, even doubtful ones, so mangled e-mail addresses (confidence near zero) stay searchable and can be redacted. On the benchmark, sensitive data left readable after redacting phone scans went from 8 of 60 to 0. Word documents with no-break spaces or paragraphs with no text no longer fail. Table rows and cells inside content controls are kept.

## 0.8.0 · 2026-11-22

- **@hilvana/office**: OCR on the device, with Tesseract compiled to WebAssembly (`tesseract-wasm`, BSD-2-Clause) and the Spanish and English models (Apache-2.0, from `@tesseract.js-data`). `makeSearchable(bytes)` reads the pages that have no text and adds an invisible text layer, so the PDF looks the same but its text can be searched, copied and redacted. It handles JPEG and Flate scans, 1-bit ones included, and rotated pages. `recognize()` and `placeWords()` support surfaces that render pages themselves. In Node, the engine and models load from the installed packages, with no network.
- **@hilvana/core**: `pagesWithoutText()`, `scannedImages()` (the scans on a page, decoded, with their position) and `addTextLayer()`.
- **@hilvana/recipes**: new `ocr` step (`language`, `force`). A `redact` step after it finds the scan's text and also paints over its pixels.
- **hilvana**: `ocr` command (`--language spa|eng`, `--force`).
- **hilvana-mcp**: the instructions describe the `ocr` step.
- **Web**: new *Reconocer texto (OCR)* tool in *Convertir*. The page draws one page at a time and the worker reads it, so memory stays flat on phones, and every scan format the browser can display is readable. The engine and models (about 4 MB per language) come from the site itself and are cached for offline use. The *Tachar información* search suggests OCR when a scan has no text.

## 0.7.0 · 2026-11-22

- **@hilvana/core**: real redaction. `redact(bytes, { areas })` removes what lies under each area from the file instead of covering it:
  - the glyphs (OCR text layers included), while the text around them keeps its place;
  - the pixels of images, transparency masks included (images it cannot edit are removed whole);
  - shapes inside the area, and the annotations and form values over it;
  - thumbnails and accessibility tags.

  It then draws the boxes and reads the result back. A page that still shows text inside an area gets a stricter pass, and if text is still there it throws `REDACTION_INCOMPLETE` instead of returning the file. `findText(bytes, { terms, patterns })` finds words and numbers (ignoring case, accents and separators in numbers) and emails, card numbers (checked with Luhn), long account or ID numbers (amounts are left alone) and phone numbers, and returns the areas that cover them. Built on a new content-stream reader that keeps byte spans.
- **@hilvana/recipes**: new destructive `redact` step (`terms`, `patterns`, `areas`). Its description does not repeat the text being redacted. New codes `NOTHING_TO_REDACT`, `REDACTION_UNSUPPORTED`, `REDACTION_INCOMPLETE`.
- **hilvana**: `redact` command (`--find`, `--pattern`, `--area page:x,y,w,h`, `--list`).
- **hilvana-mcp**: the instructions describe the `redact` step.
- **Web**: new *Tachar información* tool. It searches as you type, outlines the matches on a large page view where you can draw areas (for scans, photos and signatures), and reports what was removed and checked. The page no longer loads the engine on the main thread: since 0.5.0 it was bundled there by mistake (1.8 MB to 0.5 MB); a test now guards it. Inside the worker, pdf.js uses its modern build.

## 0.6.0 · 2026-11-22

- **@hilvana/recipes**: batches. `planBatch()` and `runBatch()` apply one recipe to each PDF or Word input separately, sharing the other inputs (a signature image). A document that fails does not stop the others; output names are made unique. Recipes that name documents or build from images cannot run as a batch (`BATCH_NAMED_FILES`, `BATCH_FROM_IMAGES`).
- **hilvana**: `run --each` writes one result per document into the `-o` folder, and reports which documents failed (exit code 1).
- **hilvana-mcp**: `each: true` in `recipe_plan` and `recipe_run`.
- **Web**: *Guardar receta* on every result, and a new *Mis recetas* tool (group *Automatizar*) that applies a saved recipe to each file or to all of them merged, asks for the image a signing recipe needs, and imports and exports recipes as `.json`. Recipes are kept only in this browser, without the names of the files they were made with; recipes that need a certificate or a password are never saved.

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
