# Hoja de ruta · Roadmap

Detalle completo en el PRD del producto (versión 0.4). · Full detail in the product PRD (v0.4).

## Fase 0 · Motor y uso interno (semanas 1–3)

- [x] Monorepo con `core`, `recipes`, `cli`, `mcp`; pruebas y CI en Linux, macOS y Windows
- [x] Motor: unir, seleccionar/reordenar, eliminar, dividir, girar, firmar con imagen, texto, marca de agua, numeración, metadatos, imágenes a PDF
- [x] Recetas v1: esquema JSON, validación con simulación de páginas, confirmación de pasos destructivos, verificación de objetivos, español e inglés
- [x] CLI y servidor MCP local con carpetas autorizadas
- [x] Política de licencias en CI (sin AGPL/GPL)
- [x] Word → PDF con texto seleccionable (motor propio + LibreOffice local opcional)
- [x] Compresión real: imágenes a su tamaño mostrado, JPEG o sin pérdida, objetivo de tamaño, benchmark publicado (`docs/compression.md`)
- [x] Paquetes listos para npm: metadatos, README por paquete, flujo de publicación con procedencia (`docs/publishing.md`)
- [x] Pasada de QA previa a la publicación: 14 defectos corregidos, 103 pruebas (`docs/qa/fase-0.md`)
- [x] Primera publicación en npm (`v0.1.0`, con procedencia y publicación de confianza sin token)
- [ ] Uso propio durante 4 semanas sin Smallpdf

## Fase 1 · MVP público (semanas 4–10)

- [x] Descifrado local de PDF protegidos solo con permisos, y apertura con contraseña (web y CLI; el MCP nunca recibe contraseñas)
- [x] Web bilingüe con procesamiento en el navegador, PWA sin conexión y política de seguridad que solo permite el propio dominio (`docs/web.md`)
- [x] QA por riesgos de la web y del motor: 7 defectos corregidos, 88 pruebas por navegador (`docs/qa/fase-1-web.md`)
- [x] Publicación en pdf.jorgegrajales.dev (Cloudflare) y `v0.1.1` en npm
- [ ] Agente integrado con enrutador de modelos (solo instrucción y metadatos; proveedores con retención cero o mínima)
- [x] Imágenes → PDF en la web (PNG y JPEG; falta HEIC)
- [ ] PDF → Word, PDF → imágenes
- [ ] Word → PDF: cuadros de texto, notas al pie, columnas, encabezado de primera página
- [ ] Arnés de calidad v1: corpus de PDFs, fidelidad, compresión, acierto del agente (corpus, OCR, tachado y compresión listos en el benchmark; faltan SSIM y acierto del agente)
- [ ] Listado en directorios de servidores MCP

## Fase 2 · Recetas (semanas 11–14)

- [x] Recetas guardadas y por lote
- [x] Protección con contraseña y firma con certificado digital
- [x] Tachado real
- [x] OCR (español e inglés), en el equipo
- [x] Benchmark público v1 (`docs/benchmark.md`)
- [x] QA de la fase 2: brechas frente al PRD y cobertura (`docs/qa/fase-2.md`)
- [x] Herramienta "Quitar contraseña" (web, CLI `unlock`, paso de receta) y recetas guardadas en el MCP (`recipe_list`, `saved`, recursos `hilvana://recipes/{id}`)
- [x] Validador y preparación de interiores para Amazon KDP, tapa blanda y dura (`docs/kdp.md`; decisión D14: en Hilvana, como receta)
- [ ] Puerta de salida: medir con señales públicas (descargas de `hilvana-mcp` en npm, estrellas, recetas compartidas); la web sigue sin enviar nada (decisión D13: escenario B)

## Motor de Word · Pendientes de la auditoría del 24 de noviembre

Detalle y verificación en [`docs/qa/auditoria-2026-11-24.md`](qa/auditoria-2026-11-24.md). Corregidos en 0.11.0: respaldo `auto`, anchos de celda, tabulaciones, encabezados por sección y altos, metadatos XMP y en el MCP, imágenes horizontales y EXIF, nombres al dividir.

- [ ] P1 · Partir filas de tabla entre páginas (respetando `cantSplit`)
- [ ] P1 · Fuentes CJK y árabes cargadas bajo demanda desde el propio sitio
- [ ] P2 · Reordenamiento bidireccional completo y párrafos `w:bidi`
- [ ] P2 · Hipervínculos como enlaces y títulos como marcadores
- [ ] P2 · Altura y sombreado de celdas combinadas verticalmente
- [ ] P1 · Compresión: el benchmark con Ghostscript como referencia (decisión D15) muestra que Hilvana reduce mucho menos (mediana 94,5 % del original frente a 52,4 %); revisar el nivel equilibrado
- [ ] P3 · Conflictos de bordes en tablas, EMF/WMF nativos, anchos en porcentaje, rellenos de tabulación, EXIF espejado

## Fase 3 · Uso pagado (semanas 15–18)

- [ ] Créditos y plan Pro (Polar), MCP remoto con medición
- [ ] Términos y política de privacidad para el servicio alojado
