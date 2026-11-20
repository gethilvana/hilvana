# Compresión · Compression

```bash
hilvana compress escaneo.pdf                    # nivel equilibrado
hilvana compress escaneo.pdf --target 2MB       # el ajuste más suave que logre ≤ 2 MB
hilvana compress informe.pdf --level lossless   # sin tocar las imágenes
```

En una receta · In a recipe:

```json
{ "version": 1, "steps": [{ "op": "compress" }], "goals": { "maxBytes": 2000000 } }
```

Sin `level`, el paso `compress` apunta automáticamente a `goals.maxBytes`. · With no `level`, `compress` aims for `goals.maxBytes` automatically.

## Cómo funciona · How it works

1. **Nunca rasteriza texto ni vectores.** Solo cambian los píxeles de las imágenes. El texto sigue siendo seleccionable y buscable. · Text and vectors are never rasterized.
2. **Mide a qué tamaño se dibuja cada imagen** recorriendo los flujos de contenido de cada página (incluidos los formularios XObject), y la reduce a la resolución del nivel *a ese tamaño*. Una foto de 2.550 px que se muestra a 2 pulgadas queda en 300 px, no en 1.125. · Each image is resampled for the size it is actually displayed at.
3. **Elige la codificación por imagen:** las fuentes JPEG siguen en JPEG; para las demás compara JPEG contra compresión sin pérdida y se queda con la sin pérdida (bordes nítidos en capturas, gráficas y logos) salvo que JPEG sea mucho más pequeño. · Lossless wins unless JPEG is much smaller.
4. **Respeta la transparencia:** la máscara suave (SMask) se redimensiona junto con su imagen.
5. **Limpieza sin pérdida:** comprime flujos sin comprimir, elimina objetos huérfanos y usa flujos de objetos.
6. **Nunca entrega un archivo más grande:** si nada ayuda, devuelve el original.
7. **Con objetivo de tamaño**, prueba primero sin pérdida y luego busca (búsqueda binaria en 8 ajustes, de 150 a 72 ppp) el ajuste más suave que lo cumpla. Si ninguno alcanza, devuelve el más pequeño posible y lo dice.

| Nivel · Level | Imágenes · Images | JPEG |
|---|---|---|
| `lossless` | sin cambios · untouched | — |
| `balanced` (por defecto) | 150 ppp | calidad 75 |
| `strong` | 110 ppp | calidad 60 |
| `max` | 72 ppp | calidad 45 |

Se omiten, sin tocarlas: imágenes CMYK, indexadas, de 16 bits, máscaras de imagen, JPEG 2000 y JBIG2. · CMYK, indexed, 16-bit, image masks, JPEG 2000 and JBIG2 images are left as they are.

## Benchmark

Corpus de prueba: fotos reales (scikit-image) escaneadas a 300 ppp con grano de sensor, una captura de pantalla, un logo con transparencia, una miniatura de una foto grande y PDFs solo de texto (comprimido y sin comprimir). SSIM compara cada página renderizada a 72 ppp contra el original (1,000 = idéntico; se reporta la peor página). "Texto" compara el texto extraído con `pdftotext`. Todos los resultados pasan `qpdf --check`.

| Archivo | Nivel | Antes | Después | Ahorro | SSIM | Texto |
|---|---|---:|---:|---:|---:|---|
| 3 fotos escaneadas | balanced | 3,84 MB | 399 KB | 89,9 % | 0,978 | igual |
| 3 fotos escaneadas | strong | 3,84 MB | 184 KB | 95,3 % | 0,964 | igual |
| 3 fotos escaneadas | max | 3,84 MB | 79 KB | 98,0 % | 0,970 | igual |
| Miniatura de foto grande | balanced | 1,08 MB | 13 KB | 98,8 % | 0,999 | igual |
| Captura de pantalla | balanced | 71 KB | 40 KB | 43,8 % | 0,971 | igual |
| Logo con transparencia | balanced | 62 KB | 49 KB | 19,7 % | 0,999 | igual |
| Texto sin comprimir | lossless | 202 KB | 24 KB | 88,3 % | 1,000 | igual |
| Texto ya comprimido | cualquiera | 23 KB | 23 KB | 0 % | 1,000 | igual |

Reproducir · Reproduce:

```bash
node scripts/bench/compress.mjs <carpeta-con-pdfs>
python3 scripts/bench/quality.py <carpeta-con-pdfs>   # requiere poppler, numpy, pillow, scikit-image
```

Tiempos de referencia: unos 0,6 s por foto de 300 ppp a un nivel fijo; con objetivo de tamaño, hasta 4 intentos.
