# Libros para Amazon KDP · Amazon KDP print books

Hilvana revisa el interior de un libro impreso (tapa blanda o tapa dura) con los requisitos de Amazon KDP y corrige lo que se puede corregir sin cambiar el contenido. Todo pasa en tu equipo. · Hilvana checks a print interior (paperback or hardcover) against Amazon KDP's requirements and fixes what can be fixed without changing the content, on your device.

```bash
npx hilvana kdp libro.pdf --trim 8.5x11                    # revisa (sale con código 1 si KDP lo rechazaría)
npx hilvana kdp libro.pdf --trim 8.5x11 --fix -o listo.pdf # corrige y vuelve a revisar
npx hilvana kdp libro.pdf --trim 6x9 --binding hardcover --json
```

En una receta · In a recipe:

```json
{ "version": 1, "steps": [{ "op": "kdpPrepare", "binding": "paperback", "trim": "8.5x11" }] }
```

`kdpPrepare` borra información (marcadores, anotaciones, metadatos) y puede reducir el contenido, así que pide confirmación. El resultado se revisa solo contra KDP. Para revisar sin cambiar nada, usa la meta `"goals": { "kdp": { "binding": "paperback", "trim": "8.5x11" } }` o, con un agente, la herramienta `kdp_check` del servidor MCP.

| Opción | Valores | Por defecto |
|---|---|---|
| `binding` | `paperback` (tapa blanda), `hardcover` (tapa dura) | — |
| `trim` | Tamaño de corte en pulgadas: `"8.5x11"`, `"6x9"`… Tapa blanda acepta tamaños personalizados entre 4–8,5" de ancho y 6–11,69" de alto | — |
| `bleed` | `true` si algo se imprime hasta el borde | `false` |
| `ink` | `black-white`, `black-cream`, `black-groundwood`, `standard-color`, `premium-color` | `black-white` |
| `fitMargins` | Ajustar el contenido que se sale de los márgenes (solo sin sangrado) | `true` |
| `padToMinimum` | Completar con páginas en blanco hasta el mínimo de KDP | `false` |

## Qué se revisa · What is checked

| Requisito de KDP | Revisión | Corrección con `kdpPrepare` |
|---|---|---|
| Tamaño de página = tamaño de corte; con sangrado, +0,125" de ancho y +0,25" de alto | Cada página (tolerancia de 1,5 pt, porque algunos programas redondean) | Escala cada página al tamaño, centrada y sin deformarla |
| Páginas: mínimo 24 (72 en color estándar; 75 en tapa dura), máximo según tapa, tamaño y tinta | Sí | Completa a número par; con `padToMinimum`, hasta el mínimo |
| Márgenes: medianil de 0,375" a 0,875" según el número de páginas; exterior, superior e inferior de 0,25" (0,375" con sangrado) | Texto, trazos e imágenes de cada página; el medianil va a la izquierda en las páginas impares y a la derecha en las pares | Sin sangrado, mueve o reduce el contenido de cada página hasta que quede dentro |
| Fuentes incrustadas | Sí, con las páginas donde se usan | No (hay que exportar de nuevo con las fuentes) |
| Imágenes de al menos 300 DPI al tamaño impreso | Sí (se ignoran adornos de menos de un cuarto de pulgada) | No |
| Transparencias aplanadas | Aviso | No |
| Sin anotaciones, comentarios, marcadores ni metadatos; sin protección | Sí | Quita anotaciones, marcadores y metadatos |
| Páginas sin girar | Sí | No |

**Formatos que KDP no ofrece** (por ejemplo, tapa dura de 8,5×11", o color estándar en A4) se rechazan antes de procesar.

**Fuentes de la especificación:** las páginas de ayuda de KDP "Set Trim Size, Bleed, and Margins" y "Paperback Submission Guidelines", revisadas el 26 de noviembre de 2026. KDP cambia sus reglas de vez en cuando: la revisión de Hilvana no reemplaza la vista previa de KDP.

**Límites conocidos:** el recorte (clip) no se tiene en cuenta al medir, así que el contenido oculto por un recorte también cuenta; los rellenos que cubren casi toda la página se toman como fondo; las portadas no se revisan.
