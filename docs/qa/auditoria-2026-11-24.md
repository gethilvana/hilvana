# Respuesta a la auditoría del generador de PDF (24 de noviembre de 2026)

Respuesta punto por punto a `qa/pdf-generator-audit-2026-11-24.md`, una auditoría automatizada de un agente independiente sobre `@hilvana/office`, `@hilvana/core` y las recetas, la CLI y el MCP. El archivo original está en la carpeta local `qa/` del repositorio, que no se publica.

**Resultado:** de los 20 hallazgos, **16 se confirmaron**, **2 se confirmaron en parte** y **1 no se reprodujo**. El restante describe un comportamiento elegido a propósito, que ahora está documentado. En la versión **0.11.0** quedaron:
- **corregidos:** 13 hallazgos (1, 3, 5, 6, 7, 8, 9, 13, 15, 16, 19 y 20, este último en parte);
- **mitigados:** 2 (2 y 4), con el respaldo automático a LibreOffice;
- **pendientes:** el resto, en la hoja de ruta con su prioridad (sección 3).

> **Supuestos.**
> 1. Cada hallazgo se verificó contra `main` en la versión 0.10.0, con un caso mínimo que reproduce lo que describe la auditoría. Ese caso quedó como prueba de regresión cuando hubo corrección.
> 2. "Confirmado" significa que el comportamiento descrito ocurre. Algunas severidades y la matriz comparativa de la auditoría no se revisaron, porque dependen de productos comerciales que no se probaron aquí.
> 3. Con LibreOffice instalado, el modo `auto` es el que usan por defecto la CLI y el MCP. En el navegador no hay LibreOffice, así que allí el motor nativo es el único y sus avisos son la protección.

## 1. Resumen

| # | Hallazgo | Severidad (auditoría) | Verificación | Estado en 0.11.0 |
|---|---|---|---|---|
| 1 | `auto` no recurre a LibreOffice con `MISSING_GLYPHS`, `COLUMNS_IGNORED`, `CONTENT_TALLER_THAN_PAGE` | Alta | Confirmado | **Corregido** |
| 2 | Una fila de tabla más alta que la página pierde contenido | Alta | Confirmado | **Mitigado** (LibreOffice en `auto`); partir filas, pendiente |
| 3 | Tablas sin `<w:tblGrid>` ignoran `<w:tcW>` | Alta | Confirmado | **Corregido** |
| 4 | Sin fuentes CJK, árabes ni índicas (salen "?") | Alta | Confirmado | **Mitigado** (LibreOffice en `auto`); fuentes, pendiente |
| 5 | `pdf_inspect` del MCP expone los valores de los metadatos | Alta | Confirmado | **Corregido** |
| 6 | `stripMetadata` deja XMP en páginas y objetos | Alta | Confirmado | **Corregido** |
| 7 | Tabulaciones personalizadas sin implementar | Media | Confirmado | **Corregido** |
| 8 | Encabezado alto se superpone al cuerpo | Media | Confirmado | **Corregido** |
| 9 | Encabezados por sección ignorados | Media | Confirmado | **Corregido** |
| 10 | Hebreo invertido (sin bidi) | Media | **En parte** | Pendiente |
| 11 | Sin hipervínculos ni marcadores | Media | Confirmado | Pendiente |
| 12 | EMF/WMF/SVG y formas se omiten | Media | Confirmado (ya documentado) | Sin cambio: ya recurre a LibreOffice |
| 13 | `imagesToPdf`: siempre vertical y sin orientación EXIF | Media | Confirmado | **Corregido** |
| 14 | `vMerge`: altura en la primera fila y sombreado de continuación | Media | Confirmado | Pendiente |
| 15 | Rangos repetidos en `split` producen nombres iguales | Media | Confirmado | **Corregido** |
| 16 | `imagesToPdf` lanza `RangeError` con imágenes dañadas | Baja | Confirmado | **Corregido** |
| 17 | No se escriben espacios en el PDF | Baja | **No reproducido** | Seguimiento |
| 18 | Bordes compartidos se dibujan dos veces | Baja | Confirmado | Pendiente |
| 19 | Las recetas usan el motor nativo por defecto | Baja | Por diseño | **Documentado** |
| 20 | Fuentes leídas del disco en cada conversión; encabezados medidos por página | Baja | **En parte** | **Corregido** (fuentes); lo otro es intencional |

## 2. Detalle por hallazgo

### 1. Respaldo a LibreOffice incompleto · Corregido
- **Verificación:** con LibreOffice instalado, `convertWord(..., { engine: 'auto' })` devolvía `engine: 'native'` para un párrafo en árabe (`MISSING_GLYPHS`) y para dos columnas (`COLUMNS_IGNORED`).
- **Precisión sobre la cita:** el texto citado no está en `docs/word.md` sino en `docs/qa/fase-0.md`, filas 77 y 78. Esa tabla prometía el respaldo para columnas, y el código no lo cumplía.
- **Corrección:** `CONTENT_LOSS` (ahora exportado) incluye los tres avisos. `docs/word.md` lista exactamente qué avisos activan el respaldo.
- **Prueba:** `packages/office/test/office.test.ts`, tres casos (árabe, columnas, fila alta), que corren donde haya LibreOffice.

### 2. Filas de tabla más altas que la página · Mitigado
- **Verificación:** confirmado. En una fila con 70 párrafos solo se ven 62; los otros 8 quedan por debajo del borde de la página. El aviso `CONTENT_TALLER_THAN_PAGE` sí se emitía.
- **Mitigación:** con el hallazgo 1, `auto` reconvierte con LibreOffice. El aviso ahora está en la tabla de limitaciones de `docs/word.md` con su efecto real ("lo que no cabe se pierde").
- **Pendiente (P1):** partir filas entre páginas, salvo las que tengan `<w:cantSplit/>`. Es lo único que protege la web, donde no hay LibreOffice.

### 3. Anchos de celda sin cuadrícula · Corregido
- **Verificación:** con celdas de 1 y 5 pulgadas sin `<w:tblGrid>`, la segunda columna empezaba en la mitad del ancho.
- **Corrección:** si la cuadrícula falta o está incompleta, cada posición toma el mayor `<w:tcW>` en `dxa` de las celdas de una sola columna. Si alguna posición queda sin ancho, se mantiene el reparto anterior.
- **Prueba:** `regressions.test.ts`, finding 3.
- **Pendiente menor:** anchos en porcentaje (`w:type="pct"`).

### 4. Alfabetos CJK, árabe e índicos · Mitigado
- **Verificación:** confirmado. Salen "?" y se emite `MISSING_GLYPHS`.
- **Mitigación:** igual que el hallazgo 2, `auto` reconvierte con LibreOffice.
- **Pendiente (decisión de producto):** incluir Noto Sans CJK y Noto Naskh Arabic. Pesan varios megabytes por familia, y la web los descarga para trabajar sin conexión. La propuesta es cargarlos solo cuando el documento los necesite, desde el propio sitio. El árabe además requiere el hallazgo 10.

### 5. Metadatos en `pdf_inspect` · Corregido
- **Verificación:** confirmado. `pdf_inspect` devolvía título, autor, asunto, palabras clave, creador y productor. Eso contradice el principio 1 de `AGENTS.md`.
- **Corrección:** el MCP devuelve `metadataFields` (qué campos tienen valor), nunca los valores. La CLI y la web los siguen mostrando, porque ahí la persona ve su propio archivo en su equipo.
- **Prueba:** `mcp.test.ts`, "never their values".

### 6. XMP fuera del catálogo · Corregido
- **Verificación:** confirmado, y con un problema adicional. `inspect` no contaba ningún XMP, ni siquiera el del documento, así que `hasMetadata` y la meta `noMetadata` podían dar falsos negativos.
- **Corrección:** `stripMetadata` quita la referencia `/Metadata` de todo objeto que la tenga (catálogo, páginas, imágenes, formularios, fuentes) y borra los flujos XMP del archivo. `PdfInfo.xmpStreams` los cuenta y `hasMetadata` los incluye. La CLI y la web ("Quitar metadatos") los muestran.
- **Prueba:** `core/test/audit-2026-11-24.test.ts`.

### 7. Tabulaciones · Corregido
- **Verificación:** confirmado. Las tabulaciones avanzaban siempre de media pulgada en media pulgada.
- **Corrección:** se leen las tabulaciones izquierda, centrada y derecha (las decimales se tratan como derechas). Se heredan por la cadena de estilos y respetan `clear`, que es como el estilo "Encabezado" de Word centra y alinea a la derecha.
- **Pruebas:** dos casos en `regressions.test.ts`.
- **Comprobación visual:** contra LibreOffice con `WordWithAttachments.docx` del corpus del benchmark.
- **Pendiente menor:** los rellenos con puntos (`leader`).

### 8. Encabezado que invade el cuerpo · Corregido
- **Verificación:** confirmado. Con 8 líneas de encabezado, la octava quedaba debajo de la primera línea del cuerpo.
- **Corrección:** antes de componer cada sección se mide la altura del encabezado y del pie. Si no caben en su margen, el cuerpo se desplaza, como en Word.
- **Prueba:** `regressions.test.ts`, finding 8.

### 9. Encabezados por sección · Corregido
- **Verificación:** confirmado. El encabezado de la última sección aparecía también en la portada.
- **Corrección:** cada sección tiene su encabezado y su pie. Si no los define, hereda los de la sección anterior, y la primera no tiene ninguno. Es la regla de Word.
- **Prueba:** `regressions.test.ts`, finding 9.
- **Comprobación visual:** `Headers.docx` (tres secciones) contra LibreOffice.
- **Sin cambio:** el encabezado distinto en la primera página sigue avisando con `FIRST_PAGE_HEADER_IGNORED`.

### 10. Texto de derecha a izquierda · Confirmado en parte, pendiente
- **Lo que no se reprodujo:** una frase solo en hebreo (`שלום עולם`) se dibuja en el orden correcto. La librería de fuentes ordena los glifos de cada tramo.
- **Lo que sí se confirmó:**
  - En "Precio שלום עולם 123 fin", el número queda después del hebreo y no antes, como indica el algoritmo bidireccional.
  - Los párrafos marcados de derecha a izquierda (`w:bidi`) se alinean a la izquierda.
  - No se emite ningún aviso.
- **Pendiente (P2):** implementar UAX #9 (reordenamiento por niveles) o integrar una librería con licencia permisiva. Mientras tanto, emitir un aviso que active el respaldo.

### 11. Hipervínculos y marcadores · Pendiente (P2)
Confirmado: no se generan anotaciones de enlace ni `/Outlines`. Ahora figura en las limitaciones de `docs/word.md`. LibreOffice sí los conserva cuando se usa ese motor.

### 12. Formatos vectoriales y formas · Sin cambio
- **Confirmado, pero ya documentado:** `UNSUPPORTED_IMAGE_FORMAT`, `TEXTBOX_SKIPPED` y `LEGACY_SHAPE_SKIPPED` ya activaban LibreOffice en `auto`, como dice la propia auditoría.
- **Sobre "preservarlo en recetas por lote":** la CLI y el MCP ya inyectan `convertWord` también en lotes (`run --each`, `each: true`), así que el respaldo aplica (ver hallazgo 19).
- **Pendiente (P3):** dibujar EMF y WMF de forma nativa.

### 13. Imágenes a PDF · Corregido
- **Verificación:** confirmado. Una imagen horizontal en A4 quedaba en página vertical, y las fotos con orientación EXIF salían de lado.
- **Corrección:**
  - Las imágenes horizontales reciben página A4 o Carta horizontal.
  - Se lee la orientación EXIF de los JPEG y se aplica a las fotos giradas (3, 6 y 8), con página de tamaño "imagen" o fija.
  - `jpegOrientation()` queda exportada.
- **Pruebas:** `core/test/audit-2026-11-24.test.ts`, con comprobación visual de los cuatro giros. La prueba de navegador "turns images into a PDF" se actualizó: `foto.png` es horizontal.
- **Pendiente menor:** las orientaciones espejadas (2, 4, 5 y 7), poco comunes en cámaras.

### 14. Celdas combinadas verticalmente · Pendiente (P2)
Confirmado por lectura del código. La altura del contenido combinado se suma a la primera fila y no se reparte entre las filas combinadas. El sombreado se toma de cada celda: si el documento solo lo declara en la primera, las demás quedan blancas.

### 15. Nombres repetidos al dividir · Corregido
- **Verificación:** confirmado. `["1","1"]` producía dos veces `sample-hilvana-1.pdf`.
- **Corrección:** las partes repetidas reciben " (2)", " (3)", la misma regla que los lotes. La comparación no distingue mayúsculas, como Windows y macOS. También cubre rangos distintos que quedan iguales al limpiarse (`"1,2"` y `"1, 2"`).
- **Prueba:** `split.test.ts`.

### 16. Imagen dañada · Corregido
- **Verificación:** confirmado (`RangeError: Invalid typed array length: 0`).
- **Corrección:** `imagesToPdf` y `stampImage` usan el mismo `embedImage()`, que convierte el error en `HilvanaError('UNSUPPORTED_IMAGE')` con el motivo.
- **Prueba:** `core/test/audit-2026-11-24.test.ts`.

### 17. Espacios en el PDF · No reproducido
- **Verificación:** el código efectivamente no escribe el carácter espacio. Sin embargo, pdf.js y `pdftotext` (Poppler) extraen "hola mundo bonito" con sus espacios, porque los infieren de la separación.
- **Contexto:** el benchmark mide la recuperación de texto en 130 documentos de Word: 92,0 %, sin cambios en esta versión.
- **Seguimiento:** si aparece un lector o extractor que junte palabras, se escribirán los espacios (operador `TJ`).

### 18. Bordes dobles · Pendiente (P3)
Confirmado por lectura del código. Las celdas vecinas dibujan el borde compartido cada una, y un borde quitado en una celda no anula el de la tabla en la vecina. Hace falta resolver los conflictos de bordes como Word.

### 19. Motor de Word en recetas · Por diseño, documentado
- **Por qué es así:** `@hilvana/recipes` también corre en el navegador, donde LibreOffice no existe. Por eso su conversor por defecto es el nativo.
- **Verificación:** la CLI (`main.ts`, `convertWord`) y el MCP (`converter()`) inyectan `convertWord`.
- **Documentación:** `docs/recipes.md` ahora explica cómo hacerlo desde Node.

### 20. Rendimiento · Corregido en parte
- **Fuentes:** `nodeFontLoader` guarda en memoria cada archivo de fuente ya leído.
- **Encabezados y pies medidos en cada página:** es intencional. Los campos `PAGE` y `NUMPAGES` cambian el ancho de la línea en cada página. El costo es pequeño: el benchmark mantiene una mediana de 50 a 80 ms por documento según la máquina, sin diferencia apreciable antes y después de estos cambios.

### Sobre la matriz comparativa
Los datos de Hilvana coinciden con lo verificado, salvo lo que esta versión corrigió (tabulaciones, encabezados por sección, anchos de celda). Las cifras de velocidad y las capacidades de Aspose, Microsoft y Adobe no se verificaron.

## 3. Pendientes en la hoja de ruta

| Prioridad | Pendiente | Hallazgo |
|---|---|---|
| P1 | Partir filas de tabla entre páginas (respetando `cantSplit`) | 2 |
| P1 | Fuentes CJK y árabes cargadas bajo demanda desde el propio sitio | 4 |
| P2 | Reordenamiento bidireccional completo y párrafos `w:bidi`; aviso mientras tanto | 10 |
| P2 | Hipervínculos como enlaces y títulos como marcadores | 11 |
| P2 | Altura y sombreado de celdas combinadas verticalmente | 14 |
| P3 | Resolución de conflictos de bordes en tablas | 18 |
| P3 | EMF/WMF nativos | 12 |
| P3 | Anchos de celda en porcentaje, rellenos de tabulación, EXIF espejado | 3, 7, 13 |

## 4. Cómo se verificó

- **Reproducción:** un caso mínimo por hallazgo con documentos Word y PDF construidos en la prueba, ejecutado contra `main` (0.10.0) antes de corregir.
- **Pruebas automáticas:** `npm test` da 308 pruebas en verde, entre ellas las regresiones nuevas de los hallazgos 1, 3, 5, 6, 7, 8, 9, 13, 15 y 16. Las de navegador (Playwright) dan 113 en verde.
- **Benchmark de Word** (`node bench/run.mjs word`), antes y después: recuperación de texto 92,01 % y mismo número de páginas que LibreOffice en 90,09 %, sin cambios.
- **Comparación visual contra LibreOffice:** `Headers.docx`, `WordWithAttachments.docx` e `issue_51265_3.docx` del corpus.
- `npm run licenses`: sin dependencias copyleft.
