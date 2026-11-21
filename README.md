# Hilvana

**Flujos de PDF para agentes, privados por diseño.** · **Agent-ready PDF workflows, private by design.**

[Español](#español) · [English](#english)

---

## Español

Hilvana une, divide, firma, numera y limpia PDFs, y convierte Word a PDF, **en tu equipo**. Ningún archivo se sube a un servidor y ningún modelo de IA ve su contenido.

Lo distinto es que trabaja con **recetas**: describes el resultado y Hilvana encadena los pasos, los valida antes de tocar nada y comprueba al final que se cumplió el objetivo. Tu agente de IA (por ejemplo Claude) puede usarlo directamente a través de un servidor **MCP**.

> Estado: **v0.1 publicada en npm**. El motor, las recetas, la CLI y el servidor MCP funcionan. La **aplicación web** (fase 1) procesa todo en el navegador, sin subir archivos, y funciona sin conexión ([docs/web.md](docs/web.md), [hoja de ruta](docs/roadmap.md)).

### Qué puede hacer hoy

| Operación | CLI | Paso de receta |
|---|---|---|
| Word (.docx) a PDF con texto seleccionable | `hilvana word` | `.docx` en `merge` |
| Unir PDFs y documentos de Word | `hilvana merge` | `merge` |
| Conservar, reordenar o eliminar páginas | `hilvana pages` | `select`, `remove` |
| Girar páginas | `hilvana rotate` | `rotate` |
| Firmar con una imagen | `hilvana sign` | `sign` |
| Escribir texto (fecha, referencia) | `hilvana stamp` | `stampText` |
| Marca de agua | `hilvana watermark` | `watermark` |
| Numerar páginas | `hilvana number` | `numberPages` |
| Borrar metadatos (autor, herramientas) | `hilvana strip` | `stripMetadata` |
| Comprimir (o llegar a un peso objetivo) sin rasterizar el texto | `hilvana compress` | `compress` |
| Imágenes a PDF | `hilvana images` | `fromImages` |
| Ejecutar una receta completa | `hilvana run` | — |

### Una receta

```json
{
  "version": 1,
  "name": "Expediente mensual",
  "steps": [
    { "op": "merge", "files": ["factura-febrero.pdf", "factura-enero.pdf"] },
    { "op": "stampText", "text": "Recibido {date}", "pages": "1", "anchor": "top-right" },
    { "op": "numberPages", "format": "Página {n} de {total}" },
    { "op": "sign", "image": "firma.png" },
    { "op": "stripMetadata" }
  ],
  "output": { "filename": "expediente-{date}" },
  "goals": { "pageCount": 5, "maxBytes": 2000000, "noMetadata": true }
}
```

```console
$ hilvana run receta.json factura-enero.pdf factura-febrero.pdf firma.png --yes
1. Unir factura-febrero.pdf, factura-enero.pdf
2. Escribir "Recibido {date}" en la página 1
3. Numerar las páginas
4. Firmar con "firma.png" en la última página
5. Borrar los metadatos (autor, título, herramientas) (borra contenido o información; requiere confirmación)
✓ expediente-2026-11-19.pdf · 5 páginas · 3.6 KB
  ✓ Pesa como máximo 1.91 MB (3.6 KB)
  ✓ Tiene exactamente 5 páginas (5)
  ✓ No contiene metadatos identificables
```

Más en [docs/recipes.md](docs/recipes.md), [docs/word.md](docs/word.md) (Word → PDF), [docs/compression.md](docs/compression.md) (compresión y benchmark) y en la carpeta [examples](examples).

### Reglas de seguridad

- **Tus archivos nunca se modifican.** El resultado siempre es un archivo nuevo, y Hilvana se niega a sobrescribir una entrada.
- **Los pasos que borran contenido** (`select`, `remove`, `stripMetadata`, `setMetadata`) piden confirmación.
- **Las recetas se validan antes de ejecutarse**: nombres de archivo, tipos y rangos de páginas después de cada paso.
- **El servidor MCP solo accede a las carpetas que autorizas**, y no sigue enlaces simbólicos hacia afuera.

Detalles en [PRIVACY.md](PRIVACY.md).

### Instalación

Requiere Node.js 20 o superior. No hace falta instalar nada más:

```bash
npx hilvana --help
npx hilvana merge a.pdf b.pdf -o ambos.pdf
```

### Usarlo con Claude (MCP)

En la configuración de Claude Desktop (`claude_desktop_config.json`), con la carpeta que quieres autorizar:

```json
{
  "mcpServers": {
    "hilvana": {
      "command": "npx",
      "args": ["-y", "hilvana-mcp", "--root", "/Users/tu-usuario/Documentos/PDFs", "--lang", "es"]
    }
  }
}
```

En Windows usa `"command": "cmd"` y antepone `"/c", "npx"` a los argumentos; escribe las rutas con `/` (por ejemplo `C:/Users/tu-usuario/Documents/PDFs`).

Luego puedes pedirle a Claude, por ejemplo: *"Une las facturas de la carpeta, numera las páginas, firma la última con firma.png y deja el resultado por debajo de 2 MB."*

Herramientas: `pdf_list`, `pdf_inspect`, `word_to_pdf`, `recipe_plan`, `recipe_run`, y el recurso `hilvana://recipe-schema`.

---

## English

Hilvana merges, splits, signs, numbers and cleans PDFs, and converts Word to PDF, **on your machine**. No file is uploaded and no AI model ever sees its content.

What makes it different is **recipes**: you describe the result, Hilvana chains the steps, validates them before touching anything, and checks at the end that the goal was met. Your AI agent (Claude, for example) can use it directly through an **MCP** server.

> Status: **v0.1 on npm**. The engine, recipes, CLI and MCP server work. The **web app** (phase 1) processes everything in the browser, never uploads files, and works offline ([docs/web.md](docs/web.md), [roadmap](docs/roadmap.md)).

### Quick start

Requires Node.js 20 or later:

```bash
npx hilvana --help --lang en
npx hilvana merge a.pdf b.pdf -o both.pdf
npx hilvana sign contract.pdf --image signature.png -o contract-signed.pdf
npx hilvana word proposal.docx            # Word → PDF with selectable text (docs/word.md)
npx hilvana compress scan.pdf --target 2MB  # gentlest setting that fits (docs/compression.md)
npx hilvana run recipe.json a.pdf b.pdf signature.png --dry-run --lang en
```

### With Claude (MCP)

```json
{
  "mcpServers": {
    "hilvana": {
      "command": "npx",
      "args": ["-y", "hilvana-mcp", "--root", "/Users/you/Documents/PDFs", "--lang", "en"]
    }
  }
}
```

On Windows, use `"command": "cmd"` and put `"/c", "npx"` before the arguments.

Tools: `pdf_list`, `pdf_inspect`, `word_to_pdf`, `recipe_plan`, `recipe_run`, plus the `hilvana://recipe-schema` resource. Destructive steps require `confirm: true`, which the agent should only send after you agree.

### Safety rules

- Inputs are never modified; results always go to a new file.
- Steps that remove content or information ask for confirmation.
- Recipes are validated against your actual files before running.
- The MCP server can only reach the folders you authorize, and does not follow symlinks out of them.

---

## Packages

| Package | What it is |
|---|---|
| [`@hilvana/core`](packages/core) | PDF engine. Bytes in, bytes out; runs in Node and the browser. |
| [`@hilvana/office`](packages/office) | Word (.docx) → PDF: own layout engine with embedded open fonts, plus an optional local LibreOffice engine. |
| [`@hilvana/recipes`](packages/recipes) | Recipe schema (JSON Schema included), validator, runner and goal checks, in Spanish and English. |
| [`hilvana`](packages/cli) | Command-line tool. |
| [`hilvana-mcp`](packages/mcp) | MCP server for AI agents. |
| [`@hilvana/web`](packages/web) | Web app (not published to npm): the same engine in the browser, as an offline-capable PWA. See [docs/web.md](docs/web.md). |

## Development

```bash
npm install
npm run build      # TypeScript project references
npm test           # Vitest
npm run licenses   # blocks AGPL/GPL in production dependencies
npm run dev -w @hilvana/web                     # web app at http://localhost:5173
npm run build:web && npm run e2e -w @hilvana/web  # browser tests (Playwright)
```

## License

[MIT](LICENSE) · Built in public by [Jorge Grajales](https://jorgegrajales.dev).
