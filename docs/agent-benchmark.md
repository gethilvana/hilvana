# Arnés del agente · Agent harness

Qué tan bien convierte cada modelo una instrucción en una receta correcta. Es la prueba que decide qué proveedor usa el agente integrado (decisión D9b del PRD, sección 9.4).

*How well each model turns a request into a correct recipe. This test decides which provider the integrated agent uses (PRD decision D9b, section 9.4).*

## Qué ve el modelo · What the model sees

El pedido de la persona y, por cada archivo, su nombre, tipo, número de páginas, tamaño y si es escaneado o está protegido. **Nunca el contenido de las páginas.** Responde con un único objeto JSON (`bench/agent/prompt.mjs`):

| Respuesta | Cuándo |
|---|---|
| `{"recipe": …}` | El pedido se puede hacer con los pasos de Hilvana. |
| `{"recipe": …, "passwordOnDevice": true}` | La persona quiere contraseña: la receta termina en `protect` sin contraseña y la app la pide en el equipo. |
| `{"question": "…"}` | Falta un dato que solo la persona sabe (qué páginas, qué texto, qué orden, una imagen de firma). |
| `{"unsupported": "…"}` | Hilvana no lo hace (traducir, resumir, editar texto, llenar formularios, pasar a Word o Excel, enviar correos, firmar con certificado). |

## El corpus · The corpus

150 pedidos en `bench/agent/corpus.mjs`: 81 en español y 69 en inglés, escritos como los escribe la gente (sin tildes, con "megas", "de cabeza", "pequeñita").

| Categoría | Casos | Qué pone a prueba |
|---|---|---|
| merge | 8 | Orden explícito, alfabético, cronológico, dejar un archivo por fuera, Word con PDF |
| select · remove | 8 · 6 | Rangos, "la última", "pares", reordenar, invertir |
| rotate | 6 | Derecha, izquierda, de cabeza, solo algunas páginas |
| compress | 10 | Niveles y límites de tamaño ("menos de 2 MB", "500 KB") |
| numberPages · stampText · watermark | 7 · 6 · 6 | Formatos, esquinas, colores, opacidad, saltar la portada |
| sign | 7 | Firma e iniciales, varias páginas, nombre del archivo |
| metadata · ocr | 6 · 6 | Quitar y cambiar metadatos, idioma del OCR, forzar |
| redact | 10 | Términos, patrones, áreas, escaneos (OCR antes de tachar) |
| protect · unlock | 7 · 4 | Restricciones sin contraseña, contraseña en el equipo, secretos que no deben repetirse |
| split · fromImages | 7 · 7 | Partes iguales, capítulos, orden de fotos, dejar la firma fuera |
| kdp | 6 | Tapa blanda y dura, sangrado, páginas mínimas, sin escalar |
| combo | 13 | Varios pasos, con orden que importa y orden que no |
| injection | 2 | Nombres de archivo con instrucciones que el modelo debe ignorar |
| question | 8 | Pedidos que no se pueden resolver sin preguntar |
| unsupported | 10 | Pedidos fuera del alcance de Hilvana |

## Cómo se califica · How answers are graded

`bench/agent/grade.mjs` acepta una respuesta cuando cumple todo esto:

1. **Formato:** es un objeto JSON con exactamente una de `recipe`, `question` o `unsupported`.
2. **Secretos:** no repite ninguna contraseña que la persona escribió.
3. **Validez:** la receta pasa `plan()` del motor real con archivos de reemplazo que tienen los mismos nombres, tipos, páginas y protecciones.
4. **Significado:** los pasos coinciden con lo esperado. Las formas equivalentes cuentan igual: `"1-3"` y `"1,2,3"`, `"last"` y `"12"` en un archivo de 12 páginas, quitar la página 12 o quedarse con la 1 a la 11, un `merge` de todo en el orden dado o ningún `merge`, `optimize` o `compress` sin pérdida. Donde el orden no cambia el resultado (marca de agua y metadatos), se acepta cualquier orden.
5. **Nada de más:** pasos, límites de tamaño o metas que nadie pidió cuentan como error.

Las razones de fallo son: `format`, `secret`, `outcome` (respondió receta cuando debía preguntar, o al revés), `invalid` (el motor la rechaza), `steps`, `size`, `goals`, `output`, `password` y `error` (la llamada al proveedor falló).

> **Supuesto:** el corpus lo escribimos nosotros, con pedidos sintéticos. Mide si el modelo entiende el contrato, no cómo pide la gente de verdad. Cuando haya recetas compartidas (señal pública de la decisión D13), se agregan como casos nuevos. Ningún pedido de una persona real entra al corpus sin su permiso.

> **Supuesto:** temperatura 0 y una repetición por defecto. Con `--repeat 3` se mide además la estabilidad ("Siempre bien": casos que salieron bien en todas las repeticiones).

## Cómo correrlo · How to run it

```bash
npm ci && npm run build
node bench/agent/run.mjs --model reference                      # el corpus contra sí mismo: debe dar 100 %
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node bench/agent/run.mjs --model workers-gpt-oss-20b --repeat 3
GROQ_API_KEY=… node bench/agent/run.mjs --model groq-gpt-oss-20b --repeat 3
OLLAMA_HOST=http://<pc>:11434 node bench/agent/run.mjs --model ollama-gpt-oss-20b
node bench/agent/run.mjs --model workers-gpt-oss-20b --only kdp,combo --lang es   # solo una parte
node bench/agent/run.mjs --model workers-gpt-oss-20b --set holdout --repeat 3       # los pedidos reservados
node bench/agent/run.mjs --regrade bench/results/agent/workers-gpt-oss-20b.p1.json  # recalificar tras un cambio documentado
```

Los resultados se guardan por versión del prompt (`<modelo>.p<versión>.json`), así que las corridas de prompts anteriores quedan como historial en la tabla.

**En una sesión de Claude Code en la nube**, la llave no va en una variable de entorno: se guarda como *network secret* del entorno, con el dominio del proveedor (`api.cloudflare.com`, `api.groq.com`…). El proxy la agrega a cada llamada y la llave nunca entra a la sesión. Cuando la variable de la llave no existe, el ejecutor llama sin encabezado de autorización y deja que el proxy lo ponga. El `CLOUDFLARE_ACCOUNT_ID` no es secreto y sí va como variable de entorno.

Los modelos candidatos, sus precios y el escenario del PRD al que pertenecen están en `bench/agent/models.json`. Las llaves van en variables de entorno y nunca se guardan en el repositorio. **Cuotas y cortes.** El avance se guarda después de cada respuesta en `bench/results/agent/progress/<modelo>.json` (no entra al repositorio). Si el proveedor se queda sin cuota (por ejemplo, la asignación gratuita diaria de Workers AI) o la sesión se corta, el arnés se detiene y lo guarda. Volver a correr el mismo comando solo pide lo que falta, así que una corrida se puede repartir en varios días, también por partes con `--only`. `--fresh` empieza de cero. Si cambia el prompt (`PROMPT_VERSION`), el avance anterior se descarta.

**Proxy.** Si la máquina sale a internet por un proxy (`HTTPS_PROXY`), el ejecutor se reinicia solo con `NODE_USE_ENV_PROXY=1`, porque sin eso el `fetch` de Node lo ignora.

Solo cuando el corpus completo tiene respuesta en todas las repeticiones, el arnés escribe `bench/results/agent/<modelo>.json` (con cada respuesta fallida para revisarla) y actualiza la tabla de abajo. Un resultado parcial nunca se publica.

## Pedidos reservados · Held-out requests

`bench/agent/holdout.mjs` tiene 40 pedidos más que **nunca se usan para ajustar el prompt**. Se escribieron después de la primera corrida y antes del prompt v2. El corpus principal sirve para encontrar huecos en las instrucciones; los reservados dicen si las correcciones generalizan. Si el prompt mejora mucho en el corpus principal y poco en los reservados, lo que aprendió fue el examen. Se corren con `--set holdout` y tienen su propia tabla.

Regla: no se cambia el prompt mirando fallas de los reservados. Si hace falta, se agregan reservados nuevos con su fecha.

## Cambios al calificador después de ver resultados · Grading changes after seeing results

Cada cambio queda aquí, con su razón, para que nadie suba el puntaje aflojando la regla:

| Fecha | Cambio | Razón |
|---|---|---|
| 2026-11-26 | Una receta sin el sobre `{"recipe": …}` cuenta como receta | Es inequívoca y la app la acepta igual. Afectaba 1 de 450 respuestas |
| 2026-11-26 | combo-15 acepta una pregunta | "numera desde la 2" puede ser "desde la página 2" o "empezando en el número 2". Preguntar es razonable |

## Resultados · Results

### Corpus principal (150)

<!-- agent-results:start -->
Umbral: 90.0 % del corpus (sección 10.2 del PRD). Solo se publican corridas con el corpus completo y todas sus repeticiones. Las de prompts anteriores quedan como historial.

| Modelo | Prompt | Escenario | Fecha | Casos × repeticiones | Acierto | Español | Inglés | Siempre bien | Fallos más comunes | Latencia p50 / p95 | Tokens entrada / salida | Costo por plan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| workers-gpt-oss-20b ✓ | v1 | A | 2026-11-27 (recalificada 2026-11-27) | 150 × 3 | 90.9 % | 91.8 % | 89.9 % | 84.0 % | outcome 17, steps 10, invalid 6 | 4.9 s / 30.9 s | 3860 / 513 | USD 0.00093 |
| reference ✓ | v2 | - | 2026-11-27 | 150 × 1 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 0.0 s / 0.0 s | 0 / 0 | — |

### Acierto por categoría

| Categoría | workers-gpt-oss-20b (v1) |
|---|---|
| combo | 84.6 % |
| compress | 86.7 % |
| fromImages | 100.0 % |
| injection | 66.7 % |
| kdp | 88.9 % |
| merge | 91.7 % |
| metadata | 100.0 % |
| numberPages | 95.2 % |
| ocr | 100.0 % |
| protect | 95.2 % |
| question | 91.7 % |
| redact | 70.0 % |
| remove | 100.0 % |
| rotate | 94.4 % |
| select | 95.8 % |
| sign | 81.0 % |
| split | 100.0 % |
| stampText | 100.0 % |
| unlock | 91.7 % |
| unsupported | 83.3 % |
| watermark | 100.0 % |
<!-- agent-results:end -->

### Pedidos reservados (40)

<!-- agent-holdout:start -->
Umbral: 90.0 % del corpus (sección 10.2 del PRD). Solo se publican corridas con el corpus completo y todas sus repeticiones. Las de prompts anteriores quedan como historial.

| Modelo | Prompt | Escenario | Fecha | Casos × repeticiones | Acierto | Español | Inglés | Siempre bien | Fallos más comunes | Latencia p50 / p95 | Tokens entrada / salida | Costo por plan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference ✓ | v2 | - | 2026-11-27 | 40 × 1 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 0.0 s / 0.0 s | 0 / 0 | — |
<!-- agent-holdout:end -->
