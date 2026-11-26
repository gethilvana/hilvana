# Word → PDF

Hilvana convierte documentos de Word (`.docx`) a PDF **en tu equipo**, con texto real y seleccionable. No sube el archivo a ningún servidor.

Hilvana converts Word documents (`.docx`) to PDF **on your machine**, with real, selectable text. The file is never uploaded.

```bash
hilvana word contrato.docx                      # → contrato.pdf
hilvana word contrato.docx --engine libreoffice # máxima fidelidad si tienes LibreOffice
hilvana merge portada.pdf contrato.docx anexo.pdf -o paquete.pdf
```

En una receta, un `.docx` se usa igual que un PDF · In a recipe, a `.docx` works anywhere a PDF does:

```json
{ "version": 1, "steps": [{ "op": "merge", "files": ["contrato.docx", "anexo.pdf"] }, { "op": "sign", "image": "firma.png" }] }
```

Con el MCP: herramienta `word_to_pdf`, o archivos `.docx` dentro de `recipe_run`.

## Motores · Engines

| Motor | Cómo funciona | Cuándo usarlo |
|---|---|---|
| `native` | Motor propio en TypeScript: lee el `.docx`, compone las páginas e incrusta fuentes abiertas compatibles en métricas con las de Office. Sin dependencias externas; también podrá correr en el navegador. | Documentos de texto: contratos, cartas, propuestas, informes con tablas e imágenes. |
| `libreoffice` | Usa una instalación local de LibreOffice. | Documentos con cuadros de texto, formas, notas al pie o diseños complejos. |
| `auto` (por defecto) | Usa `native`; si tuvo que omitir o cambiar contenido (avisos `TEXTBOX_SKIPPED`, `LEGACY_SHAPE_SKIPPED`, `NOTES_SKIPPED`, `UNSUPPORTED_IMAGE_FORMAT`, `FLOATING_IMAGE_INLINED`, `MISSING_GLYPHS`, `COLUMNS_IGNORED` o `CONTENT_TALLER_THAN_PAGE`) y LibreOffice está instalado, repite con LibreOffice. En el navegador no hay LibreOffice: se muestran los avisos. | Siempre, salvo que quieras forzar uno. |

## Qué cubre el motor nativo · Native engine coverage

- Estilos de párrafo y carácter con herencia, fuentes del tema, valores por defecto del documento.
- Negrita, cursiva, subrayado, tachado, color, resaltado, superíndice y subíndice, mayúsculas.
- Alineación (izquierda, centro, derecha, justificado), sangrías, sangría francesa, espaciado antes y después, interlineado (múltiple, exacto, mínimo), espaciado contextual.
- Listas con viñetas y numeradas, multinivel (decimal, letras, romanos).
- Tablas: anchos de columna (de la cuadrícula o, si falta, de los anchos de cada celda), celdas combinadas (horizontal y vertical), sombreado, bordes de tabla y de celda, alineación vertical, márgenes de celda, tablas anidadas, y filas de encabezado que se repiten en cada página.
- Imágenes PNG y JPEG en línea.
- Saltos de página y de sección; cada sección conserva su tamaño, orientación (vertical u horizontal) y márgenes.
- Control de cambios: se muestran las inserciones y se ocultan las eliminaciones, como en la vista "Final".
- Encabezado y pie de página predeterminados de cada sección (una sección sin los suyos hereda los de la anterior), con campos `PAGE` y `NUMPAGES` ("Página 1 de 3"). Si son más altos que su margen, empujan el cuerpo como en Word.
- Tabulaciones personalizadas: izquierda, centrada y derecha (las decimales se alinean a la derecha), heredadas por estilo y con borrado (`clear`).
- Fuentes: Calibri/Aptos → Carlito, Cambria → Caladea, Arial → Arimo, Times New Roman → Tinos, Courier New → Cousine (todas SIL OFL, compatibles en métricas). Alfabetos latino, griego, cirílico, vietnamita y hebreo; símbolos como ✓ ✗ ☐ ☑ ★ con Noto Sans Symbols 2 (OFL).

## Limitaciones conocidas · Known limitations

El motor nativo **avisa** cuando simplifica algo; nunca lo omite en silencio. Avisos posibles:

| Código | Qué pasa |
|---|---|
| `TEXTBOX_SKIPPED` | Los cuadros de texto no se dibujan. |
| `FLOATING_IMAGE_INLINED` | Las imágenes flotantes se ubican en línea con el texto. |
| `UNSUPPORTED_IMAGE_FORMAT` | Imágenes EMF, WMF o SVG no se dibujan. |
| `LEGACY_SHAPE_SKIPPED` | Formas VML antiguas no se dibujan. |
| `NOTES_SKIPPED` | Notas al pie y al final no se incluyen. |
| `FIRST_PAGE_HEADER_IGNORED` | Un encabezado distinto para la primera página usa el general. |
| `MISSING_GLYPHS` | Caracteres sin fuente disponible (emojis, árabe, flechas) se reemplazan por "?". |
| `COLUMNS_IGNORED` | El texto en varias columnas se pone en una sola. |
| `CONTENT_TALLER_THAN_PAGE` | Una fila de tabla más alta que la página no se parte: lo que no cabe se pierde. |
| `PAGE_FIELD_IN_BODY` | Un número de página dentro del cuerpo (no en encabezado o pie) queda vacío. |

Además: las palabras en hebreo se dibujan en su orden, pero no hay reordenamiento bidireccional completo (números o texto latino dentro de un párrafo en hebreo, párrafos de derecha a izquierda); árabe, chino, japonés, coreano e índicos salen como "?" (`MISSING_GLYPHS`); los hipervínculos no quedan como enlaces y los títulos no forman marcadores; los comentarios no se imprimen (como en Word por defecto), los saltos de línea pueden diferir en alguna palabra frente a Word, y el espacio entre un párrafo y el siguiente suma el "después" del primero y el "antes" del segundo, como Word (LibreOffice a veces los combina).

## Cómo se verificó · How it was verified

- Pruebas automáticas que extraen el texto del PDF con pdf.js (como lo haría un lector o un buscador) y verifican acentos, listas, saltos de página y "Página X de Y".
- Comparación visual página por página contra LibreOffice con tres documentos: uno generado con la librería `docx`, uno basado en la plantilla de Word (tema, estilos y numeración reales) y uno guardado por LibreOffice (bordes por celda, celdas combinadas, listas anidadas).
