# Informe de QA · Fase 0

Fecha: 19 de noviembre de 2026 · Alcance: `@hilvana/core`, `@hilvana/office`, `@hilvana/recipes`, `hilvana` (CLI) y `hilvana-mcp`, antes de la primera publicación en npm.

## Resumen

| Indicador | Antes | Después |
|---|---:|---:|
| Pruebas automáticas | 65 | 103 |
| Archivos de prueba | 7 | 13 |
| Defectos encontrados | — | 14 (todos corregidos) |
| Defectos de seguridad | — | 3 (D5, D6, D7) |
| Casos generados por pruebas de propiedades | 0 | ~5.600 por corrida |
| Entradas no generadas por Hilvana en el corpus | 0 | 16 PDF + 12 Word extremos + 9 casos de compresión |

**Veredicto:** apto para publicar la versión 0.1.0, con las limitaciones conocidas de la última sección documentadas.

## 1. Análisis de las pruebas existentes

La cobertura inicial era de 84 % de líneas y 72 % de ramas. Hallazgos del análisis:

- **Todas las pruebas usaban PDF creados por la propia herramienta.** No había archivos de otros programas (LibreOffice, qpdf), cifrados, dañados, con formularios, con páginas rotadas o con cajas desplazadas.
- **CLI y binario MCP sin pruebas automáticas** (0 %); solo se habían probado a mano.
- **Seguridad de archivos probada solo con nombres**, no con enlaces simbólicos, enlaces duros ni nombres de salida que vienen de recetas compartidas.
- **Sin pruebas de propiedades** para rangos de páginas y operaciones, que son la base de las recetas.
- **Privacidad afirmada pero no verificada** por una prueba.
- **Word probado con tres documentos**, sin casos extremos.

## 2. Estrategia

Pruebas basadas en riesgo, por capas:

1. **Corpus de archivos ajenos** (`/tmp/qa/in`, reproducible con los scripts de esta rama): PDF de LibreOffice, linealizado, sin comprimir (QDF), cifrado con contraseña de apertura, cifrado solo con permisos (AES-256 y RC4), con formulario, con páginas rotadas 0/90/180/270, con MediaBox desplazada y CropBox, de 300 páginas, truncado, con `startxref` roto, vacío y falso. Cada una de las 13 operaciones se ejecutó sobre cada archivo (224 combinaciones), y cada salida se validó con `qpdf --check`.
2. **Verificación visual** de sellos, numeración, firma y marca de agua en páginas rotadas y con cajas desplazadas.
3. **Seguridad**: path traversal desde recetas, rutas absolutas, enlaces simbólicos y duros hacia la entrada o fuera de la carpeta autorizada, prefijos de carpeta, mayúsculas en la extensión, reemplazo de salidas existentes.
4. **Word extremo** (12 documentos): control de cambios, notas al pie y comentarios, tabla de 120 filas, imagen más grande que la página, secciones vertical y horizontal, columnas, TOC e hipervínculos, 80 párrafos encadenados con "conservar con el siguiente", símbolos, árabe, hebreo y emojis, documento vacío, celdas vacías y tablas anidadas, y 1.500 párrafos.
5. **Compresión extrema** (9 casos): escala de grises, CMYK, paleta, 16 bits, JPEG progresivo, la misma imagen a dos tamaños, imagen dentro de un formulario XObject, JPEG corrupto, PDF de LibreOffice; doble pasada para medir pérdida acumulada.
6. **Pruebas de propiedades** (fast-check): rangos de páginas aleatorios contra un oráculo, selección y eliminación complementarias, unión en orden, cuatro rotaciones igual a identidad, y basura aleatoria sin caídas.
7. **Privacidad como prueba**: una receta completa (Word, sellos con griego y ✓, marca de agua, firma, compresión y borrado de metadatos) con todas las entradas de red de Node interceptadas.

## 3. Defectos encontrados y corregidos

| ID | Severidad | Componente | Defecto | Corrección | Prueba de regresión |
|---|---|---|---|---|---|
| D1 | Alta | core | Sellos, marca de agua y numeración con caracteres fuera de WinAnsi (✓, griego, cirílico, emoji) se caían con un error interno | Fuentes embebidas con respaldo por carácter; sin fuentes, error estable `UNSUPPORTED_CHARACTERS` | `core/test/regressions.test.ts` D1 |
| D2 | Media | core | Un PDF truncado causaba `TypeError` en vez de `INVALID_PDF` | Validación del árbol de páginas al cargar | D2 |
| D3 | Alta | core | En páginas rotadas, sellos, número de página y firma salían de lado o en la esquina equivocada | Posicionamiento en el marco visual y transformación a coordenadas de página | D3 (posiciones medidas con pdf.js) |
| D4 | Media | core | Con MediaBox desplazada o CropBox, sellos y firma quedaban fuera del área visible | Marco visual basado en la CropBox | D4 |
| D5 | **Seguridad** | recipes/CLI | Una receta compartida con `"filename": "../../x"` podía escribir fuera de la carpeta | `safeFilename`: solo nombre de archivo, sin `..`, rutas ni nombres reservados de Windows | recipes D5 y CLI |
| D6 | **Seguridad** | CLI | Con `--force`, un enlace simbólico o duro hacia la entrada permitía sobrescribirla | Comparación por identidad de archivo (dispositivo + inodo); rechazo de enlaces simbólicos; reemplazo por renombrado atómico | CLI "never overwrites an input" |
| D7 | **Seguridad** | MCP | Un enlace simbólico en el nombre de salida permitía escribir fuera de las carpetas autorizadas o sobre una entrada | Rechazo de salidas que son enlaces y escritura segura | MCP D7 |
| D8 | Baja | CLI | Un comando desconocido mostraba toda la ayuda sin explicar el error | Mensaje "Comando desconocido" | CLI D8–D10 |
| D9 | Baja | CLI | Un JSON de receta mal formado daba un error técnico en inglés | Mensaje localizado | CLI D8–D10 |
| D10 | Baja | CLI | `--angle 45` decía solo "parámetro inválido" | Mensaje con los valores permitidos | CLI D8–D10 |
| D11 | Media | office | Un documento con secciones vertical y horizontal salía todo en la orientación de la última | Configuración de página por sección | office D11 |
| D12 | Media | office | Las filas de encabezado de tabla no se repetían en cada página | Repetición de encabezados al continuar la tabla | office D12 (150 filas, ninguna perdida) |
| D13 | Baja | office | El texto en columnas se ponía en una sola sin avisar | Aviso `COLUMNS_IGNORED` | office D13 |
| D14 | Alta | core | Unir o seleccionar páginas de un PDF con formulario dejaba los campos sin registrar (no rellenables) | Se reconstruye la lista de campos y se renombran duplicados (`nombre_2`) | core D14 |

Mejoras adicionales hechas durante las pruebas: fuente de símbolos (✓ ✗ ☐ ☑ ★) como respaldo para Word y para sellos; la viñeta "●" se dibuja como "•" para coincidir con Word; la CLI ya no falla con EPIPE cuando su salida se pasa a `head`.

## 4. Lo que se verificó sin encontrar defectos

- PDF linealizados, sin comprimir, de LibreOffice, con `startxref` roto (pdf-lib lo repara), de 300 páginas: todas las operaciones válidas según qpdf.
- Cifrados (AES-256, RC4, solo permisos), vacíos y falsos: rechazados con códigos claros.
- Compresión: idempotente (una segunda pasada no degrada); la imagen usada a dos tamaños se dimensiona para el mayor; las imágenes dentro de formularios XObject se miden con su matriz; un JPEG corrupto se omite y se devuelve el original intacto.
- Word: control de cambios, imagen gigante escalada, tabla de 150 filas sin pérdidas, 80 "conservar con el siguiente" sin bucles infinitos, 1.500 párrafos en 2,7 s.
- Seguridad del MCP: `../`, rutas absolutas fuera de la raíz y raíces que son prefijo de otra carpeta, bloqueados.
- Privacidad: ninguna llamada de red en un flujo completo.

## 5. Riesgos residuales y limitaciones conocidas

| Tema | Situación | Mitigación actual |
|---|---|---|
| PDF cifrados, incluidos los que solo tienen permisos (comunes en extractos bancarios) | No se pueden procesar; pdf-lib no descifra | Mensaje claro. Propuesto para fase 1: descifrado local de PDF sin contraseña de apertura |
| Imágenes CMYK, indexadas originales, JPEG 2000, JBIG2 | No se recomprimen | Se dejan intactas; documentado |
| Escritura de derecha a izquierda (árabe, hebreo) y emojis en Word | Sin reordenamiento bidi; emojis como "?" | Aviso `MISSING_GLYPHS`; motor LibreOffice opcional |
| Columnas, notas al pie, cuadros de texto en Word | No se dibujan | Avisos y respaldo automático a LibreOffice si está instalado |
| Cobertura de la CLI y del binario MCP | Probados de punta a punta en subprocesos; la herramienta de cobertura no los instrumenta | 13 pruebas de comportamiento sobre los binarios reales |
| Plataformas | CI en Linux, macOS y Windows con Node 20 y 22 | Enlaces simbólicos probados donde el sistema lo permite |

## 6. Cómo reproducir

```bash
npm install && npm run build
npm test                                   # 103 pruebas
npx vitest run --coverage                  # cobertura
node scripts/bench/compress.mjs <carpeta>  # benchmark de compresión
python3 scripts/bench/quality.py <carpeta> # SSIM y texto
```
