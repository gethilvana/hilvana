# QA de la fase 2 · Recetas, seguridad, tachado y OCR (0.9.0)

Revisión de la fase 2 contra el PRD (versión 0.4, secciones 7, 10, 11 y 15) y análisis de cobertura de pruebas de todas las funciones publicadas hasta `0.9.0`.

**Veredicto: la fase 2 está completa en lo que el PRD pide como entregable** (recetas guardadas y por lote, OCR, tachado y benchmark público v1). Quedan abiertos un requisito P2 (F-20), dos huecos de alcance (HEIC y recetas como recurso MCP) y la **puerta de salida**, que no se puede medir hoy (sección 2.3). Esta pasada no encontró defectos nuevos; cerró los huecos de cobertura con 25 pruebas.

> **Supuestos.** (1) El PRD de referencia es el documento `PRD_Hilvana` v0.4 del 18 de noviembre de 2026, que no está en el repositorio. (2) "Fase 2" son las filas F-14 a F-18 y F-20 de la sección 7 más los entregables de la sección 15. (3) Los requisitos de la fase 1 que siguen abiertos se listan aparte, porque no bloquean la fase 2 pero sí la hoja de ruta.

## 1. Alcance

| En alcance | Fuera de alcance (y por qué) |
|---|---|
| Requisitos de la fase 2 del PRD y su estado real en el código | Fase 3 (créditos, Pro, MCP remoto, términos) |
| Cobertura de pruebas de `core`, `office`, `recipes`, `cli`, `mcp` y `web` | Agente integrado (F-12): no existe todavía, no hay nada que medir |
| Métricas del arnés de calidad (PRD 10.2) frente al benchmark publicado | Prueba manual con un certificado real (la hace Jorge, sección 6) |

## 2. Brechas frente al plan

### 2.1 Requisitos de la fase 2

| ID | Requisito (PRD) | Estado | Evidencia |
|---|---|---|---|
| F-14 | Recetas guardadas, compartibles sin archivos y ejecutables por lote | **Hecho** | `web/src/saved.ts`, `recipes/src/batch.ts`, `run --each` (CLI), `each` (MCP) |
| F-15 | Marca de agua, numeración, encabezado y pie | **Hecho** (desde la fase 0) | `watermark`, `numberPages`, `stampText` con ancla arriba o abajo |
| F-16 | Proteger y quitar protección conocida | **Hecho** | `protect` (AES-256, permisos), apertura con contraseña; firma con certificado como extra |
| F-17 | OCR en español e inglés | **Hecho**, solo local | `office/src/ocr.ts` (tesseract-wasm). El "S para lotes" del PRD queda para la fase 3 por decisión de producto ("todo local por ahora") |
| F-18 | Tachado real y borrado de metadatos | **Hecho** | `core/src/redact.ts`, `stripMetadata` |
| F-20 | Validador de interior KDP (P2, uso interno) | **No iniciado** | Sin código. Es P2: puede pasar a la fase 3 o salir del plan |
| — | Benchmark público v1 | **Hecho** | `bench/`, `docs/benchmark.md` (la casilla de la hoja de ruta seguía sin marcar; corregido) |

### 2.2 Arnés de calidad (PRD 10.2) frente al benchmark v1

| Métrica del PRD | Meta | Qué mide hoy el benchmark | Brecha |
|---|---|---|---|
| OCR: CER en español a 300 DPI | ≤ 5 % | CER ≈ 0,3 % en prosa; palabras 93–94 % | Cumplida |
| Compresión frente a Smallpdf e iLovePDF | Igual o mejor en ≥ 60 % | Frente a qpdf (94,5 % frente a 96,4 % de reducción) | **Referencia distinta.** Medir contra servicios en línea exige subir el corpus a terceros; se propone mantener qpdf y Ghostscript como referencia y decirlo en la metodología |
| Fidelidad visual de conversión (SSIM) | ≥ 0,90 en el 80 % | Recuperación de texto y páginas frente a LibreOffice | **No medida.** Falta comparar páginas renderizadas (SSIM) |
| Acierto del agente | ≥ 90 % ES y EN | — | Depende de F-12 |
| Operaciones destructivas sin confirmación | 0 | Pruebas en motor, CLI, MCP y lotes | Cumplida (cubierta por pruebas, no por el benchmark) |
| Privacidad: bytes enviados en modo local | 0 | Guardia de red en todas las pruebas de navegador y prueba de motor sin red | Cumplida |
| Puerta 7: no publicar si una métrica baja más de 2 puntos | — | El benchmark se corre a mano | **No automatizada.** Falta comparar `bench/results/latest.json` con la versión anterior en CI o antes de publicar |
| Corpus: 150+ instrucciones con su receta esperada | — | — | Depende de F-12 |

### 2.3 Puerta de salida de la fase 2

El PRD pide **≥ 20 % de usuarios activos con recetas guardadas**. Hoy no se puede medir: la web no tiene analítica (la política de seguridad la bloquea a propósito) y las recetas viven solo en el navegador. Tres caminos:

| Escenario | Cómo se mide | A favor | En contra |
|---|---|---|---|
| A. Contador agregado propio | La web envía un evento sin contenido ("receta guardada", "receta usada") a un endpoint en el mismo dominio (Cloudflare Worker) | Mide la meta tal como está escrita; el PRD ya permite "solo eventos agregados" | Rompe la promesa más simple ("la página no envía nada"); hay que explicarlo, hacerlo visible y quizás opcional |
| B. Señales públicas | Descargas en npm, estrellas, recetas compartidas en GitHub, uso de `run --each` reportado por personas | Cero cambios en privacidad | No mide a los usuarios de la web, que son la mayoría esperada |
| C. Cambiar la puerta | Sustituir el 20 % por una meta cualitativa (por ejemplo, 10 recetas compartidas por la comunidad) | Coherente con "nada sale del equipo" | Deja de ser comparable con el PRD |

Recomendación con supuestos: **B ahora y A solo si se decide en la fase 3**, cuando el servicio alojado ya obligue a tener términos y política de privacidad.

### 2.4 Pendientes de fases anteriores

- **Fase 0:** uso propio durante 4 semanas sin Smallpdf (solo lo puede cerrar Jorge).
- **Fase 1:** agente integrado (F-12), PDF → Word (F-08) y PDF → imágenes, HEIC en imágenes → PDF (F-06, hoy solo PNG y JPEG), huecos del conversor Word (cuadros de texto, notas al pie, columnas, primera página), listado en directorios MCP.
- **MCP (PRD 7.1):** las recetas guardadas no se exponen como recurso, porque viven en el navegador. Una carpeta de recetas autorizada (`~/.hilvana/recetas`) lo resolvería sin tocar la privacidad.
- **Publicación:** la web está en `pdf.jorgegrajales.dev` y npm va en `0.9.0`; la casilla de la fase 1 seguía sin marcar (corregido).

## 3. Registro de riesgos de la fase 2

Misma escala que en las fases anteriores: probabilidad (P) e impacto (I) de 1 a 3.

| ID | Riesgo | P | I | Puntaje | Cómo se prueba | Resultado |
|---|---|---|---|---|---|---|
| R1 | El tachado deja texto recuperable | 2 | 3 | **6** | Cada prueba relee el PDF con pdf.js; benchmark con 60 documentos digitales y escaneados | 0/60 fugas. **Hueco:** el parser y el tachado no tenían pruebas con `TJ` con interletraje, `'`, `"`, cadenas con escapes, imágenes en línea ni figuras. Cerrado (sección 4) |
| R2 | Una contraseña o certificado pasa por el modelo o queda guardado | 1 | 3 | **3 → crítico** | El MCP rechaza `signDigital` y `protect` con contraseña; recetas mostradas con `••••••`; la CLI lee secretos de un prompt oculto o variables de entorno | Sin hallazgos. **Hueco:** la escritura en `localStorage` no tenía prueba directa. Cerrado |
| R3 | Una firma digital se invalida al proteger o volver a firmar | 2 | 3 | **6** | `security.test.ts` verifica con `pdfsig` (obligatorio en CI) | Sin hallazgos; falta la prueba manual con certificado real |
| R4 | El OCR lee mal números (cuentas, cédulas) | 3 | 2 | **6** | Benchmark: números exactos 83–88 % (nativo 87–90 %) | Riesgo residual conocido: tablas con números partidos |
| R5 | Un lote pisa archivos o mezcla resultados | 2 | 2 | **4** | `batch.test.ts`, `run --each`, `each` en MCP | Sin hallazgos. **Hueco:** el escritor seguro (`safewrite.ts`) solo se probaba de forma indirecta. Cerrado |
| R6 | Escaneos sin pérdida (Flate) o dentro de formularios no se leen | 2 | 2 | **4** | OCR con JPEG y 1 bit | **Hueco:** gris y color sin pérdida, escaneos dentro de un *form XObject* y formatos no soportados sin pruebas. Cerrado |
| R7 | El tachado no reconoce tarjetas o teléfonos | 2 | 2 | **4** | Patrones `email` y `number` probados | **Hueco:** `card` (con dígito de control) y `phone` sin pruebas. Cerrado |
| R8 | La web se vuelve pesada al cargar el motor | 2 | 1 | **2** | Prueba que impide importar el motor en la página | Sin hallazgos |

## 4. Pruebas añadidas en esta pasada

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `core/test/content.test.ts` | 7 | Escapes en cadenas (octales, continuación de línea, paréntesis anidados), hexadecimales, diccionarios en contenido marcado, imágenes en línea con bytes que parecen operadores, reescritura byte a byte y errores de sintaxis |
| `core/test/redact-content.test.ts` | 5 | Tachado en `TJ` con interletraje, `'` y `"`; imagen en línea y figura dentro del área (y las de fuera se conservan); página ilegible → `REDACTION_UNSUPPORTED`; tarjetas con dígito de control; teléfonos |
| `core/test/textlayer.test.ts` | 3 | Escaneos Flate en gris y color, mapeo píxel → página, escaneo dentro de un *form XObject*, logos pequeños ignorados, CCITT y datos truncados contados como no soportados |
| `web/test/saved-storage.test.ts` | 4 | Orden y borrado, sin nombres de archivo de `merge`, **nunca** se escribe una contraseña o un certificado, almacenamiento dañado, ajeno, bloqueado o lleno |
| `mcp/test/safewrite.test.ts` | 6 | Escritor de CLI y MCP: no pisa entradas (ni por enlace duro), no escribe por enlaces simbólicos, reemplazo atómico sin temporales |

## 5. Cobertura

Pruebas unitarias con `@vitest/coverage-v8`; la CLI se mide aparte con `NODE_V8_COVERAGE` porque sus pruebas ejecutan el binario; la interfaz web, con las pruebas de navegador (`COVERAGE=1`, monocart).

| Paquete | Pruebas | Líneas | Ramas | Notas |
|---|---|---|---|---|
| `core` | unitarias | 86–100 % por archivo | 69–98 % | `redact.ts` 93 % / 70 % (antes 88 % / 62 %); `content.ts` 100 % / 90 % (antes 67 % / 76 %); `textlayer.ts` 99 % / 69 % (antes 93 % / 58 %) |
| `office` | unitarias | 68–100 % | 47–100 % | `convert.ts` y `libreoffice.ts`: las ramas sin LibreOffice instalado |
| `recipes` | unitarias | 98–100 % | 85–100 % | |
| `mcp` | unitarias | 95–97 % | 79–83 % | `safewrite.ts` 80 % (antes 68 %) |
| `cli` | binario | 89 % | 65 % | Ramas de errores de E/S y de ayuda |
| `web` (lógica) | unitarias | 97–100 % | 95–98 % | `saved.ts` 100 % (antes 54 %) |
| `web` (interfaz) | navegador | 93 % | 88 % | 110 pruebas en escritorio y móvil; Firefox, Safari e iPhone en CI |

Totales: **276 pruebas unitarias** (antes 251) y **110 de navegador** por motor. El total global de `vitest` (69 % de líneas) es engañoso: incluye la interfaz y la CLI, que se miden con las otras dos herramientas.

**Huecos que quedan, aceptados:**

- `worker.ts` de la web no aparece en la cobertura del navegador (los *workers* no se instrumentan). Su lógica está en el motor, probado aparte, y cada herramienta lo atraviesa en las pruebas de navegador.
- La segunda pasada estricta del tachado (`strictPass`) y `REDACTION_INCOMPLETE` no tienen un caso que las active: hace falta un PDF cuyo texto pdf.js ubique distinto que el motor. Si aparece un archivo así, se agrega al corpus y como prueba.
- Fuentes CID con anchos por rango (`c_first c_last w`) y fuentes Type3 en el tachado: sin fixture todavía.

## 6. Condiciones y siguientes pasos

1. **Prueba manual con certificado real** (Jorge): firmar, proteger y volver a firmar, y verificar en Adobe Acrobat Reader.
2. Decidir la puerta de salida (sección 2.3) y si F-20 (KDP) sigue en el plan.
3. Añadir al benchmark SSIM de páginas en la conversión Word y una comparación automática con la versión anterior (puerta 7).
4. Revisión con lector de pantalla y prueba en un Android físico (pendientes desde la fase 1).
