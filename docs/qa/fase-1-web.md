# QA de la fase 1 · Aplicación web y motor 0.1.1

Plan de pruebas basado en riesgos y resultado de su ejecución antes de publicar la web en `pdf.jorgegrajales.dev` y la versión `0.1.1` de los paquetes en npm.

**Veredicto: listo para publicar (*go*), con las condiciones de la sección 7.**

## 1. Alcance

| En alcance | Fuera de alcance (y por qué) |
|---|---|
| Aplicación web (`packages/web`): 12 herramientas, vistas previas, uso sin conexión, idioma, accesibilidad | Agente integrado y enrutador de modelos (siguiente entrega de la fase 1) |
| Motor usado por la web: `@hilvana/core`, `@hilvana/office`, `@hilvana/recipes` | Infraestructura de Cloudflare (se verifica después de desplegar, sección 8) |
| Configuración que se despliega: política de seguridad, cabeceras, *service worker* | Dispositivos físicos: se usó emulación de iPhone y Android (riesgo residual R7) |
| Chrome, Firefox y Safari (WebKit) de escritorio; Android e iPhone emulados | Lectores de pantalla reales (revisión manual pendiente, riesgo residual R8) |

## 2. Método

Cada riesgo se califica por **probabilidad** (1 baja, 2 media, 3 alta) por **impacto** (1 molestia, 2 trabajo perdido o confianza dañada, 3 daño a la persona o a la promesa del producto). Con ese puntaje se decide la profundidad de las pruebas: los riesgos de 6 o más llevan pruebas automáticas que **leen el contenido del resultado**, no solo comprueban que exista. Los de 3 a 4 llevan pruebas de comportamiento y los de 1 a 2, pruebas de humo.

> **Supuesto:** el uso real se parece a los casos de las pruebas: documentos de oficina (facturas, contratos, extractos, escaneos) de hasta unos cientos de páginas o unas decenas de MB. Archivos mucho más grandes, o deliberadamente hostiles, se rechazan o se explican, pero no se optimizaron.

## 3. Registro de riesgos

| ID | Riesgo | P | I | Puntaje | Cómo se prueba | Resultado |
|---|---|---|---|---|---|---|
| R1 | Contenido de un documento sale del equipo | 1 | 3 | **3 → tratado como crítico** | Guardia de red en **todas** las pruebas (página, *workers* y *service worker*: solo archivos propios). Política de seguridad en meta y cabecera, `fetch` externo bloqueado, el *service worker* nunca guarda documentos ni resultados, el *build* no contiene dominios desconocidos | Sin hallazgos |
| R2 | Resultado incorrecto que parece correcto (páginas faltantes, orden, sello en otra página, firma en otra esquina) | 2 | 3 | **6** | 15 pruebas que extraen el texto o la posición de las imágenes del PDF descargado: orden al unir, páginas al organizar y dividir, sello solo en la página elegida, número correcto en cada página, firma en la esquina elegida, texto idéntico tras comprimir, fecha local y no UTC | Sin hallazgos |
| R3 | Archivos raros u hostiles: cifrados, vacíos, dañados, disfrazados, "bombas zip", nombres con código | 3 | 2 | **6** | 11 pruebas de entradas hostiles + pruebas del motor | **D15, D16, D17, D21** |
| R4 | Estado de la interfaz: doble clic, cambiar de herramienta o de idioma a mitad, reemplazar el archivo | 2 | 2 | **4** | 11 pruebas de carreras y estado | **D19** |
| R5 | Sin conexión y actualizaciones: la app vieja queda en caché o falla sin red | 2 | 2 | **4** | Sin conexión (unir y Word), despliegue simulado de una versión nueva, limpieza de cachés viejas | Sin hallazgos (el defecto de `Vary: Origin` se corrigió antes de esta pasada) |
| R6 | Documentos grandes: la página se congela o se queda sin memoria | 2 | 2 | **4** | 300 páginas en la cuadrícula (dibujo diferido), PDF de 23 MB con fotos comprimido sin bloquear la interfaz (tareas largas < 500 ms) | **D22** |
| R7 | Diferencias entre navegadores | 2 | 2 | **4** | Las 88 pruebas en Chrome, Firefox y Safari; móvil en Android e iPhone emulados | Solo diferencias aceptables (Safari cambia espacios por `_` en descargas) |
| R8 | Accesibilidad: no se puede usar con teclado, contraste, nombres | 2 | 2 | **4** | axe (WCAG 2.1 AA) en las 12 herramientas, vacías y con archivos, en ambos idiomas; flujo completo con teclado; foco visible; movimiento reducido | **D20** |
| R9 | Mezcla de idiomas | 2 | 1 | **2** | Paridad de textos (prueba unitaria), errores del motor y notas en inglés, textos por defecto que siguen el idioma | Cubierto por D16 |
| R10 | Descargas con nombres inseguros o .zip dañado | 1 | 2 | **2** | Nombres con `../`, `:`, `"`, `?` y tildes; contenido del .zip | Sin hallazgos (ver nota D18) |
| R11 | Configuración desplegada débil | 1 | 3 | **3** | `_headers` con la misma política que la meta, más `frame-ancestors`, `nosniff`, `no-referrer`; sin *source maps* | Sin hallazgos |
| R12 | Regresiones del motor | 2 | 2 | **4** | 129 pruebas unitarias, propiedades (miles de casos) y motor sin `Buffer` de Node | **D22** |

## 4. Defectos encontrados

| ID | Severidad | Defecto | Corrección | Prueba de regresión |
|---|---|---|---|---|
| **D22** | Crítica | Comprimir cualquier PDF **con imágenes** fallaba en el navegador ("Buffer is not defined"): `jpeg-js` usa `Buffer` cuando existe `module`, y el *bundler* lo define. Las pruebas anteriores no tenían PDFs con imágenes | `encodeJpeg` presta un `Buffer` mínimo solo durante la llamada | `core/test/no-node-globals.test.ts` (falla sin la corrección), `e2e/scale.spec.ts` |
| **D15** | Alta (seguridad) | Un .docx de 3 MB podía expandirse a **3,2 GB** en memoria y tumbar la pestaña | Solo se extraen las partes que el conversor lee y las imágenes referenciadas. Hay límites por parte (64 MB), total (256 MB) y número de partes, y se rechazan partes que mienten sobre su tamaño | 4 pruebas en `office/test/regressions.test.ts`, `e2e/hostile.spec.ts` |
| **D19** | Media | Si se cambiaba de herramienta mientras otra trabajaba, el resultado viejo aparecía en la nueva (por ejemplo, un PDF unido bajo "Numerar páginas") | Cada ejecución tiene un número; cambiar de herramienta invalida la anterior | `e2e/state.spec.ts` |
| **D17** | Media | Los PDF cifrados (con contraseña o solo con permisos) se reportaban como "no es un PDF válido" | Se reporta `ENCRYPTED`, con un mensaje que explica cómo desbloquearlo | `core/test/regressions.test.ts`, `e2e/hostile.spec.ts` |
| **D20** | Media (accesibilidad) | Contraste 4,0:1 en los títulos del menú (WCAG AA pide 4,5:1) | Gris más oscuro: 5,3:1 | `e2e/a11y.spec.ts` |
| **D16** | Baja | En la web, los errores de Word se mostraban como códigos (`ENCRYPTED_DOCX`) | Se traducen con el nombre del archivo | `e2e/hostile.spec.ts`, `e2e/i18n.spec.ts` |
| **D21** | Baja | XML dañado dentro de un .docx mostraba el mensaje del parser ("unclosed xml tag(s)") | Se reporta `CORRUPT_DOCX` | `office/test/regressions.test.ts`, `e2e/i18n.spec.ts` |

**D18 (descartado):** en este entorno de pruebas, Chrome nombraba `download` los archivos con tildes. La causa era el *locale* "C" del contenedor, no la app: con UTF-8, como en cualquier computador y en GitHub Actions, el nombre se conserva. La configuración de pruebas fija UTF-8 y la prueba lo verifica.

## 5. Cobertura

| | Antes | Después |
|---|---|---|
| Motor, líneas / ramas | 83,7 % / 74,5 % | **91,8 % / 76,5 %** |
| Web (código que ejecutan las pruebas de navegador), líneas / ramas | 87,7 % / 81,2 % | **93–100 % / 86–94 % por archivo** |
| Pruebas unitarias y de propiedades | 103 | **129** (15 archivos) |
| Pruebas de navegador | 21 en Chrome | **88 por navegador** × Chrome, Firefox y Safari, más Android e iPhone |

Notas:
- La CLI aparece con 0 % porque sus pruebas la ejecutan como proceso aparte, y la herramienta de cobertura no mide subprocesos. Funcionalmente está cubierta: `cli.test.ts` prueba los binarios reales.
- La cobertura de la web se mide en el hilo principal de Chromium (`COVERAGE=1 npm run e2e -w @hilvana/web`). El motor dentro del *worker* se mide con las pruebas unitarias.
- La cobertura es una señal, no la meta: el registro de riesgos decide qué probar y con qué profundidad.

## 6. Criterios de salida

| Criterio | Estado |
|---|---|
| Ningún defecto crítico o alto abierto | ✓ D22 y D15 corregidos con pruebas de regresión |
| Todos los riesgos con puntaje ≥ 4 tienen pruebas automáticas que pasan | ✓ |
| Cero peticiones fuera de la app en todas las pruebas de navegador | ✓ Guardia automática en las 88 pruebas × 3 navegadores |
| WCAG 2.1 AA sin violaciones automáticas | ✓ |
| CI verde en Linux, macOS y Windows (motor) y en los tres navegadores (web) | ✓ |
| Política de licencias | ✓ Sin dependencias *copyleft* en producción |

## 7. Veredicto y condiciones

**Go.** Condiciones:
1. Publicar `0.1.1` en npm: D15, D17, D21 y D22 afectan a quien use los paquetes, en especial D22 en navegadores.
2. Desplegar en Cloudflare Pages según `docs/web.md`, con Web Analytics, Rocket Loader y la ofuscación de correos **desactivados**.
3. Ejecutar la verificación posterior al despliegue (sección 8) antes de compartir el enlace.

### Riesgos residuales aceptados

| Riesgo | Por qué se acepta | Plan |
|---|---|---|
| PDFs con solo restricciones de permisos (muchos extractos bancarios) no se procesan | Se explican con un mensaje claro; procesarlos requiere descifrado | Fase 1 (hoja de ruta) |
| Solo emulación de móviles, sin dispositivos físicos | Los motores son los mismos (Chromium, WebKit); faltan memoria y rendimiento reales | Probar en un iPhone y un Android propios en las 4 semanas de uso |
| Sin revisión con lector de pantalla real | axe, teclado y nombres accesibles pasan; la experiencia hablada no se ha oído | Revisión con VoiceOver y NVDA antes de anunciar |
| Imágenes JPEG 2000 en las vistas previas (usan WebAssembly) no se probaron | La política permite `wasm-unsafe-eval` solo para eso; la vista previa es opcional y no afecta el resultado | Agregar un PDF con JPX al corpus del arnés de calidad |
| Un .docx que miente sobre el tamaño de una imagen referenciada puede ocupar CPU unos segundos | La memoria queda acotada y la interfaz no se congela (todo corre en el *worker*) | Ninguno por ahora |

## 8. Verificación después de desplegar

1. `curl -sI https://pdf.jorgegrajales.dev` muestra `Content-Security-Policy` con `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy`.
2. Ver el código fuente: no hay `<script>` que no sea de `/assets/`. Si Cloudflare inyectó algo, desactivarlo.
3. Con las herramientas de desarrollo en la pestaña Red: unir dos PDF y convertir un Word. Ninguna petición sale de `pdf.jorgegrajales.dev`.
4. Comprimir un PDF con fotos (D22) y firmar uno.
5. Activar el modo avión, recargar y unir dos PDF.
6. Repetir 3 a 5 en un iPhone y en un Android.

## 9. Cómo correr las pruebas

```bash
npm run build && npx vitest run                     # motor + lógica de la web (129)
npm run build:web
npm run e2e -w @hilvana/web                          # Chrome (88 + móvil)
ALL_BROWSERS=1 npm run e2e -w @hilvana/web           # + Firefox, Safari, iPhone (requiere npx playwright install)
COVERAGE=1 npm run build:web && COVERAGE=1 npm run e2e -w @hilvana/web   # cobertura en packages/web/coverage-e2e
```
