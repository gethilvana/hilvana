# Benchmark público · Public benchmark

Qué tan bien funciona Hilvana con documentos que no hicimos nosotros, medido de forma que cualquiera lo pueda repetir. Todo corre en un equipo, sin enviar archivos a ningún servicio.

*How well Hilvana does on documents we did not make, measured so anyone can repeat it. Everything runs on one machine; no file is sent to any service.*

## Qué se mide · What is measured

| Tarea | Corpus | Cómo se mide | Referencia local |
|---|---|---|---|
| OCR en español | 12 documentos sintéticos (extractos, facturas y cartas, con datos inventados) escaneados en 5 condiciones | Palabras leídas frente al texto exacto (F1, sin importar el orden), números leídos exactamente, y errores por carácter en las cartas | Tesseract nativo (mismo motor, modelo `fast`) |
| Tachado | Los mismos 12 documentos, en PDF digital y escaneados con calidad de celular | Cuántos de los 5 datos sensibles de cada documento siguen legibles (en el texto del resultado y en un segundo OCR), y cuánto del resto del texto se conserva | — |
| Word a PDF | 130 documentos de prueba de [Apache POI](https://github.com/apache/poi/tree/trunk/test-data/document) | Documentos convertidos, palabras del Word presentes en el PDF, páginas frente a LibreOffice | LibreOffice |
| PDF reales | 200 archivos de prueba de [pdf.js](https://github.com/mozilla/pdf.js/tree/master/test/pdfs) (muestra fija) | Unir, sellar y tachar: resultado válido, mismas páginas, texto intacto, o rechazo con explicación | — |
| Compresión | Los PDF de la muestra con imágenes y más de 100 KB | Tamaño del resultado y texto intacto | qpdf (sin pérdida) |

**Condiciones de escaneo:** `limpio-300` (300 ppp, JPEG de buena calidad), `movil-200` (200 ppp, JPEG calidad 60, como una app de celular), `torcido-200` (girado 1,5° y con ruido), `byn-200` (blanco y negro de 1 bit, como un escáner de oficina) y `baja-150` (150 ppp, desenfocado, JPEG calidad 50).

## Supuestos y límites · Assumptions and limits

> **Los documentos del OCR y del tachado son sintéticos.** No hay un conjunto público de escaneos en español con su texto exacto que se pueda descargar sin restricciones, y usar documentos reales de personas no es aceptable. Los sintéticos imitan la estructura de extractos, facturas y cartas colombianas, con nombres, cédulas, cuentas, correos y teléfonos inventados, y se generan siempre igual (`bench/scans.mjs`, semilla fija). Son más limpios que muchos escaneos reales: los resultados son un techo, no un promedio.

> **El texto se compara sin importar el orden.** El OCR puede leer una tabla columna por columna; las palabras quedan bien aunque el orden cambie. Por eso la medida principal es el F1 de palabras, y los errores por carácter se informan solo en las cartas.

> **Smallpdf y otros servicios en línea no se incluyen.** Exigen subir los documentos, y el benchmark compara solo herramientas que corren en el equipo. Las referencias son las alternativas de código abierto que la gente usa localmente.

> **Los corpus de POI y pdf.js no se redistribuyen.** `bench/corpus.mjs` los descarga de su origen en un commit fijo y guarda el SHA-256 de cada archivo en `bench/corpus.json`. Cada documento conserva los derechos de sus autores.

> **"Rechazo con explicación" no es un fallo.** Un PDF cifrado con certificado, o uno que no se puede tachar con seguridad, debe rechazarse con un mensaje claro en vez de producir un archivo dañado o que filtre datos.

## Cómo repetirlo · How to run it

Necesita Node.js 20 o superior, Poppler (`pdftoppm`, `pdfimages`) e ImageMagick (`convert`). Para las referencias: Tesseract 5 con el idioma `spa`, LibreOffice y qpdf (opcionales: sin ellos esas columnas quedan vacías).

```bash
npm ci && npm run build
node bench/corpus.mjs      # descarga los corpus públicos y escribe bench/corpus.json
node bench/scans.mjs       # genera los documentos sintéticos y sus escaneos
node bench/run.mjs         # o solo algunas tareas: node bench/run.mjs ocr redact
```

El resultado completo, documento por documento, queda en `bench/results/latest.json`, y la sección de resultados de este archivo se actualiza sola.

## Resultados · Results

<!-- results:start -->
Última ejecución: 2026-11-22 · Hilvana 0.9.0 · Node v22.23.5 · Intel(R) Xeon(R) Processor @ 2.30GHz

### OCR en español (12 documentos sintéticos por condición)

Palabras: F1 de las palabras leídas frente al texto exacto, sin importar el orden. Números: cifras leídas exactamente (cuentas, cédulas, montos, fechas). Errores por carácter: solo en las cartas, donde el orden de lectura no es ambiguo.

| Condición | Palabras (Hilvana) | Números (Hilvana) | Errores por carácter (Hilvana) | Tiempo por página (Hilvana) | Palabras (Tesseract nativo) | Números (Tesseract nativo) | Errores por carácter (Tesseract nativo) |
|---|---|---|---|---|---|---|---|
| limpio-300 | 94.1 % | 88.4 % | 0.3 % | 1.85 s | 96.1 % | 89.9 % | 0.3 % |
| movil-200 | 94.1 % | 86.1 % | 0.3 % | 1.36 s | 94.1 % | 86.7 % | 0.3 % |
| torcido-200 | 94.4 % | 87.8 % | 0.3 % | 1.32 s | 94.8 % | 88.9 % | 0.4 % |
| byn-200 | 93.5 % | 84.1 % | 0.4 % | 1.40 s | 94.6 % | 86.6 % | 0.3 % |
| baja-150 | 93.0 % | 83.1 % | 0.3 % | 1.17 s | 95.4 % | 87.7 % | 0.4 % |

### Tachado (nombre, cédula, cuenta, correo y celular de cada documento)

| Origen | Documentos | Datos que siguen legibles | Resto del texto conservado | Tiempo |
|---|---|---|---|---|
| PDF digital | 12 | 0 de 60 | 100.0 % | 38 ms |
| Escaneo de celular, con OCR | 12 | 0 de 60 | 100.0 % | 1.68 s |

### Word a PDF (130 documentos de prueba de Apache POI)

| | Hilvana | LibreOffice |
|---|---|---|
| Convertidos | 114 de 130 | 112 de 130 |
| Palabras del documento presentes en el PDF (donde ambos convierten, 111 docs) | 91.9 % | 95.4 % |
| Mismo número de páginas que LibreOffice | 90.1 % (± 1 página: 94.6 %) | — |
| Tiempo mediano por documento | 51 ms | — |

### PDF reales (200 archivos de prueba de pdf.js, muestra fija)

6 archivos no se pudieron abrir y se rechazaron con un mensaje.

| Operación | Correctos | Texto intacto | Rechazados con explicación | Fallos | Tiempo mediano |
|---|---|---|---|---|---|
| unir | 194 de 194 | 192 de 194 | 0 | 0 | 1 ms |
| sello | 193 de 194 | 189 de 193 | 1 | 0 | 2 ms |
| tachar | 186 de 194 | — | 8 | 0 | 4 ms |
| comprimir | 193 de 194 | 191 de 193 | 1 | 0 | 1 ms |

### Compresión (15 PDF reales con imágenes y más de 100 KB, nivel equilibrado)

| | Hilvana | qpdf (sin pérdida) |
|---|---|---|
| Tamaño mediano del resultado | 94.5 % del original | 96.4 % del original |
| Archivos más pequeños | 14 de 15 | — |
| Texto intacto | 15 de 15 | — |

<!-- results:end -->

## Qué cambió gracias al benchmark · What it changed

Cada hallazgo quedó con una prueba automática que lo reproduce.

- **Tachado de escaneos:** en la primera ejecución quedaban legibles 8 de 60 datos sensibles. El OCR leía la "@" de los correos como "(D", "0", "Q" o la omitía, y les daba confianza casi nula; además la capa de texto descartaba las palabras dudosas, así que el tachado no las veía. Ahora la capa conserva todas las palabras, el patrón de correos reconoce esas formas dañadas, y al tachar un nombre también se tachan los usuarios y correos que lo contienen (como `ana.perez` o `ana.64`). Resultado: 0 de 60.
- **Word a PDF:** 5 documentos que LibreOffice sí convertía fallaban. Tres por espacios de no separación (algunas fuentes no los traen; ahora se dibujan como espacio normal), dos por párrafos sin texto (solo una imagen) cuya fuente de respaldo no se preparaba. Además, las filas y celdas de tabla envueltas en controles de contenido (`w:sdt`, comunes en formularios) se perdían.
- **PDF reales:** un archivo con los recursos de la página guardados como flujo en vez de diccionario hacía fallar sellar, comprimir y tachar; ahora se repara al abrirlo. Una entrada de fuente dañada hacía fallar el tachado; ahora se usa un ancho promedio. Y un archivo con el árbol de páginas dañado perdía una página sin avisar: ahora se informa (`missingPages`) antes de procesarlo.
