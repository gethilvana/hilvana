# hilvana-mcp

MCP server that lets AI agents (Claude and others) run **private, local** PDF and Word workflows: list and inspect files, convert Word to PDF, and plan/run recipes (merge, sign, number, compress, clean metadata) with confirmation for destructive steps. Files never leave your computer, and the agent only sees structure, never content.

```json
{
  "mcpServers": {
    "hilvana": { "command": "npx", "args": ["-y", "hilvana-mcp", "--root", "/path/to/your/PDFs", "--lang", "es"] }
  }
}
```

Tools: `pdf_list`, `pdf_inspect`, `word_to_pdf`, `recipe_plan`, `recipe_run` · Resource: `hilvana://recipe-schema` · MIT

`pdf_inspect` returns structure only: which metadata fields are set (`metadataFields`), never their values.

**Saved recipes:** put recipe `.json` files (as the web app exports them from *My recipes*) in `~/.hilvana/recetas`, or pass `--recipes <folder>` (or `HILVANA_RECIPES`). The agent then gets `recipe_list`, a `hilvana://recipes/{id}` resource per recipe, and can run one with `saved: "<id>"` in `recipe_plan` and `recipe_run`. The folder is only read; passwords in a hand-written recipe are never shown, and recipes that need one are refused.
