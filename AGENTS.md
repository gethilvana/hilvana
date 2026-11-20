# Notes for AI coding agents

This file tells coding agents (Claude Code and others) how to work in this repository.

## Product principles (do not break)

1. **Privacy first.** `@hilvana/core`, `@hilvana/office` and `@hilvana/recipes` must never make network calls (the optional LibreOffice engine is a local process with a throwaway profile). Nothing that touches document bytes may send them anywhere. Tools exposed to models return structure only, never page text or images.
2. **Inputs are immutable.** Every operation returns new bytes. Writers refuse to overwrite an input and only replace other files when explicitly asked.
3. **Destructive steps need confirmation.** Keep `DESTRUCTIVE_OPS` in `packages/recipes/src/schema.ts` up to date when adding steps that drop content or overwrite information.
4. **Bilingual.** Every user-facing message exists in Spanish and English (`packages/recipes/src/i18n.ts`). Errors carry stable codes; surfaces localize them.
5. **Permissive licenses only.** No AGPL/GPL/LGPL/SSPL production dependencies. `npm run licenses` enforces this in CI.

## Layout

- `packages/core`: PDF operations on `Uint8Array`, environment-agnostic (Node and browser). Built on `pdf-lib` (MIT).
- `packages/office`: Word (.docx) → PDF. `parse.ts` builds a layout model (styles, numbering, tables, images, header/footer), `layout.ts` paginates and draws with embedded Fontsource fonts (`fonts.ts`), `convert.ts` picks native or local LibreOffice. Verify layout changes visually against LibreOffice, not only with tests.
- `packages/recipes`: Zod schema → JSON Schema, `plan` (validate + simulate page counts), `run` (execute + verify goals).
- `packages/cli`: `hilvana` command.
- `packages/mcp`: `hilvana-mcp` stdio server; `FolderGuard` restricts file access to authorized roots after resolving symlinks.

## Adding a recipe step

1. Implement the operation in `packages/core/src/operations.ts` with a test in `packages/core/test`.
2. Add the step schema to `Step` in `packages/recipes/src/schema.ts` (strict object, described fields).
3. Handle it in `plan` (page-count simulation, range checks) and `apply` in `engine.ts`.
4. Add its description in both languages in `i18n.ts`.
5. Add recipe tests, and update `docs/recipes.md`.

## Commands

```bash
npm install
npm run build
npm test
npm run licenses
```
