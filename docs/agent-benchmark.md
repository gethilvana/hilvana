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
```

**En una sesión de Claude Code en la nube**, la llave no va en una variable de entorno: se guarda como *network secret* del entorno, con el dominio del proveedor (`api.cloudflare.com`, `api.groq.com`…). El proxy la agrega a cada llamada y la llave nunca entra a la sesión. Cuando la variable de la llave no existe, el ejecutor llama sin encabezado de autorización y deja que el proxy lo ponga. El `CLOUDFLARE_ACCOUNT_ID` no es secreto y sí va como variable de entorno.

Los modelos candidatos, sus precios y el escenario del PRD al que pertenecen están en `bench/agent/models.json`. Las llaves van en variables de entorno y nunca se guardan en el repositorio. Cada corrida escribe `bench/results/agent/<modelo>.json`, con cada respuesta fallida para revisarla, y actualiza la tabla de abajo.

## Resultados · Results

<!-- agent-results:start -->
Umbral: 90.0 % del corpus (sección 10.2 del PRD). Solo cuentan para la decisión las corridas con el corpus completo.

| Modelo | Escenario | Fecha | Casos × repeticiones | Acierto | Español | Inglés | Siempre bien | Fallos más comunes | Latencia p50 / p95 | Tokens entrada / salida | Costo por plan |
|---|---|---|---|---|---|---|---|---|---|---|---|
| reference ✓ | - | 2026-11-26 | 150 × 1 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 0.0 s / 0.0 s | 0 / 0 | — |
<!-- agent-results:end -->
