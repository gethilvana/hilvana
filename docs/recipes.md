# Recetas · Recipes (v1)

Una receta es un JSON con pasos que se aplican en orden sobre un documento de trabajo. La especificación completa está en el JSON Schema: `hilvana schema` o el recurso MCP `hilvana://recipe-schema`.

A recipe is a JSON list of steps applied in order to a working document. The full spec is the JSON Schema: `hilvana schema` or the MCP resource `hilvana://recipe-schema`.

## Estructura · Structure

```json
{
  "version": 1,
  "name": "optional",
  "steps": [ ... ],
  "output": { "filename": "resultado-{date}" },
  "goals": { "maxBytes": 2000000, "pageCount": 5, "maxPages": 10, "noMetadata": true }
}
```

- Los archivos se referencian por **nombre** (por defecto, el nombre del archivo). · Files are referenced by **name** (the file name by default).
- **PDF protegidos · Protected PDFs:** los que solo tienen restricciones se desbloquean solos; los que piden contraseña la reciben en `InputFile.password` (API) o `--password` (CLI). El plan avisa qué se quitó. · Files with only restrictions unlock on their own; those that need a password take it in `InputFile.password` (API) or `--password` (CLI). The plan says what was removed.
- Si el primer paso no es `merge` ni `fromImages`, Hilvana une primero todos los PDF en el orden recibido. · If the first step is not `merge` or `fromImages`, all PDFs are merged first in the order given.
- `{date}` se reemplaza por la fecha local (AAAA-MM-DD); `{name}` por el nombre del primer archivo. · `{date}` becomes the local date; `{name}` the first input's name.

## Pasos · Steps

| op | Parámetros · Parameters | Destructivo |
|---|---|---|
| `merge` | `files?: string[]` | |
| `fromImages` | `files?: string[]`, `pageSize?: "image" \| "a4" \| "letter"` | |
| `select` | `pages` (también reordena: `"3,1-2"`) | sí |
| `remove` | `pages` | sí |
| `rotate` | `angle: 90 \| 180 \| 270 \| -90`, `pages?` | |
| `stampText` | `text`, `pages?`, `anchor?`, `size?`, `color?` | |
| `sign` | `image`, `pages?` (por defecto `last`), `anchor?`, `width?` | |
| `watermark` | `text`, `pages?`, `opacity?`, `color?` | |
| `numberPages` | `format?` (`{n}`, `{total}`), `anchor?`, `pages?` | |
| `stripMetadata` | — | sí |
| `setMetadata` | `title?`, `author?`, `subject?` | sí |
| `optimize` | — (sin pérdida) | |
| `compress` | `level?: "lossless" \| "balanced" \| "strong" \| "max"`, `targetBytes?` (por defecto, `goals.maxBytes`) | |
| `split` | `ranges?: string[]` (sin rangos: un archivo por página). **Solo como último paso** · Last step only | |
| `protect` | `password?`, `allowPrint?`, `allowCopy?`, `allowModify?` (por defecto `true`). **Solo como último paso** · Last step only | |
| `signDigital` | `certificate` (nombre de la entrada `.p12`/`.pfx`), `reason?`, `location?`, `visible?` (por defecto `true`), `pages?` (`last`), `anchor?` (`bottom-right`). **Solo como último paso** · Last step only | |

**Dividir · Split:** una receta que termina en `split` produce varios archivos: `{nombre}-{rango}.pdf` (o `{nombre}-{página}.pdf`). Los objetivos se comprueban en cada parte. En la CLI, `-o` es la carpeta de las partes y se crea si no existe. En el MCP, `output` es una carpeta existente dentro de las autorizadas; se comprueban todos los destinos antes de escribir. · A recipe ending with `split` produces several files, and goals are checked on each part. CLI: `-o` is the folder (created if needed). MCP: `output` is an existing allowed folder; every destination is checked before anything is written.

```json
{ "version": 1, "steps": [{ "op": "merge" }, { "op": "numberPages" }, { "op": "split", "ranges": ["1-3", "4-last"] }], "output": { "filename": "lote" } }
```

**Proteger · Protect:** cifra el resultado con AES-256. Con `password`, solo se abre con ella; sin ella, solo restringe el uso (imprimir, copiar, modificar), algo que los lectores respetan pero no garantiza privacidad. Necesita una contraseña o al menos una restricción (`NOTHING_TO_PROTECT`). La receta que se muestra o comparte debe pasar por `redactRecipe()`, que reemplaza la contraseña. · Encrypts the result with AES-256: `password` is needed to open it; without one, only usage restrictions apply. Use `redactRecipe()` before showing or sharing a recipe.

**Firma digital · signDigital:** firma con un certificado `.p12`/`.pfx` que se da como entrada; su contraseña va en `InputFile.password` de esa entrada, nunca en la receta (en la CLI, `HILVANA_CERT_PASSWORD` o se pide al ejecutar). `plan` abre el certificado y devuelve `signer` (nombre, emisor, vigencia), y avisa si es autofirmado o está vencido. Firma PAdES B-B (ETSI.CAdES.detached) con la hora del equipo, sin servidor de sellado de tiempo. Una receta que solo tiene `signDigital` sobre un único PDF firma ese archivo tal cual: las firmas que ya tenía siguen válidas, y entonces no se escribe la línea visible. Cualquier otra receta firma el documento nuevo. · Signs with a `.p12`/`.pfx` input whose password travels in that input, never in the recipe. A recipe with only `signDigital` on one PDF signs it as is, so existing signatures stay valid.

**Secretos y agentes · Secrets and agents:** el servidor MCP rechaza `signDigital` y `protect` con `password` (código `SECRET_NOT_ALLOWED`), porque el secreto pasaría por el modelo de IA. `protect` solo con restricciones sí se permite. · The MCP server refuses `signDigital` and `protect` with a `password`.

```json
{ "version": 1, "steps": [{ "op": "merge" }, { "op": "signDigital", "certificate": "mi-certificado.p12", "reason": "Apruebo" }] }
```

**Por lote · Batches:** la misma receta a cada documento por separado ("numera y sella cada factura"). Los documentos son las entradas PDF y Word; las demás (la imagen de una firma) se comparten. La receta no puede nombrar documentos (`BATCH_NAMED_FILES`) ni crear un PDF desde imágenes (`BATCH_FROM_IMAGES`). Si un documento falla, los demás siguen y se informa cuál. En la CLI: `hilvana run receta.json *.pdf --each -o carpeta`. En el MCP: `each: true` en `recipe_plan` y `recipe_run`, con `output` como carpeta. En código: `planBatch()` y `runBatch()`. · The same recipe on each document separately; other inputs are shared; a failing document does not stop the others.

**Recetas guardadas · Saved recipes:** en la web, cualquier resultado ofrece **Guardar receta**; *Mis recetas* las aplica a otros archivos, uno por uno o todos juntos, y las importa y exporta como `.json`. Se guardan solo en ese navegador, sin los nombres de los archivos con que se hicieron. Las que necesitan un certificado o una contraseña nunca se guardan. · In the web app, any result can be saved as a recipe (only in that browser, never with secrets) and reused from *My recipes*.

**Rangos de páginas · Page ranges** (1-based): `"1-3,5"`, `"last"`, `"last-1"`, `"4-last"`, `"odd"`, `"even"`, `"all"`.

**Anclas · Anchors:** `top-left`, `top-center`, `top-right`, `center`, `bottom-left`, `bottom-center`, `bottom-right`.

## Ciclo de vida · Lifecycle

1. **plan**: valida el esquema, los nombres y tipos de archivo, y simula el número de páginas tras cada paso para detectar rangos que no existirán. No modifica nada. · Validates schema, file names and kinds, and simulates page counts after each step. Changes nothing.
2. **confirm**: si hay pasos destructivos, se requiere confirmación explícita. · Destructive steps require explicit confirmation.
3. **run**: ejecuta localmente y escribe un archivo nuevo (o uno por parte con `split`). · Runs locally and writes a new file (one per part with `split`).
4. **verify**: comprueba cada objetivo y explica el resultado (✓/✗). Un objetivo no cumplido no se oculta. · Checks each goal and explains the outcome. Unmet goals are reported, never hidden.
