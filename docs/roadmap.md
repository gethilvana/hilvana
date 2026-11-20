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
- [ ] Primera publicación en npm (requiere la cuenta y el token de npm)
- [ ] Uso propio durante 4 semanas sin Smallpdf

## Fase 1 · MVP público (semanas 4–10)

- [ ] Web bilingüe en pdf.jorgegrajales.dev (procesamiento en el navegador, PWA)
- [ ] Agente integrado con enrutador de modelos (solo instrucción y metadatos; proveedores con retención cero o mínima)
- [ ] PDF → Word, imagen ↔ PDF en la web
- [ ] Word → PDF: cuadros de texto, notas al pie, columnas, encabezado de primera página
- [ ] Arnés de calidad v1: corpus de PDFs, fidelidad, compresión, acierto del agente
- [ ] Listado en directorios de servidores MCP

## Fase 2 · Recetas (semanas 11–14)

- [ ] Recetas guardadas y por lote
- [ ] OCR (español e inglés), tachado real, protección con contraseña
- [ ] Benchmark público v1

## Fase 3 · Uso pagado (semanas 15–18)

- [ ] Créditos y plan Pro (Polar), MCP remoto con medición
- [ ] Términos y política de privacidad para el servicio alojado
