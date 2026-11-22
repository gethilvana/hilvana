# Aplicación web

`packages/web` es Hilvana en el navegador. Usa el mismo motor que la CLI y el servidor MCP (`@hilvana/core`, `@hilvana/office`, `@hilvana/recipes`), así que lo que funciona en un lado funciona en el otro.

## Privacidad, comprobable

- **Todo se procesa en el navegador**, en un *Web Worker*. No hay servidor que reciba archivos.
- **La página solo puede conectarse a su propio dominio.** La política de seguridad (`Content-Security-Policy`) va en una etiqueta `<meta>` del HTML y como cabecera HTTP (`dist/_headers`). El navegador bloquea cualquier otra conexión: analítica, CDNs o APIs. Las únicas peticiones son los archivos de la propia app y sus fuentes tipográficas.
- **Funciona sin conexión** después de la primera visita, gracias a un *service worker* que guarda la app. Los documentos nunca pasan por él.
- Las vistas previas de páginas usan pdf.js (Apache-2.0), solo para dibujar. Todos los cambios a los documentos los hace el motor de Hilvana.

**Licencias de terceros.** La compilación genera `dist/THIRD_PARTY_NOTICES.txt` (`scripts/notices.mjs`) con la licencia de cada paquete, fuente y archivo de pdf.js que se incluye en la app. El pie de página enlaza a ese archivo.

Las pruebas de navegador (`packages/web/e2e/privacy.spec.ts`) verifican la política, que un `fetch` a otro dominio queda bloqueado y que la app funciona sin conexión.

## Herramientas

| Grupo | Herramienta | Paso de receta |
|---|---|---|
| Unir y ordenar | Unir PDF (incluye Word) | `merge` |
| | Organizar páginas (quitar, reordenar) | `select` |
| | Dividir (por página o por rangos, con .zip) | `split` |
| | Girar páginas | `rotate` |
| Convertir | Word a PDF | `.docx` en `merge` |
| | Imágenes a PDF | `fromImages` |
| | Reconocer texto (OCR), en el navegador | `ocr` |
| Firmar y marcar | Firmar (dibujada o imagen) | `sign` |
| | Firma digital (certificado .p12/.pfx) | `signDigital` |
| | Sello de texto | `stampText` |
| | Numerar páginas | `numberPages` |
| | Marca de agua | `watermark` |
| Reducir y proteger | Comprimir | `compress` |
| | Quitar metadatos | `stripMetadata` |
| | Tachar información (buscar textos y datos, o dibujar áreas) | `redact` |
| | Proteger con contraseña (o restringir el uso) | `protect` |
| Automatizar | Mis recetas (guardadas en el navegador; por archivo o juntas) | la receta guardada |

Cada resultado ofrece **Ver como receta**: la misma acción en JSON, lista para `npx hilvana run` o para un agente con el servidor MCP. Las contraseñas nunca aparecen en ella; el certificado, su clave y las contraseñas viven solo en la memoria de la página y del worker, y se olvidan al cambiar de herramienta.

## Desarrollo

```bash
npm install
npm run build                    # paquetes del motor
npm run dev -w @hilvana/web      # http://localhost:5173
```

Pruebas de navegador (Playwright) contra la versión de producción:

```bash
npm run build:web
npx playwright install chromium   # una vez
npm run e2e -w @hilvana/web
```

Con un Chrome ya instalado: `CHROME_PATH=/ruta/a/chrome npm run e2e -w @hilvana/web`.

## Publicar en pdf.jorgegrajales.dev (Cloudflare)

Cloudflare publica la app como un *Worker* que solo sirve archivos estáticos (`wrangler.jsonc` en la raíz). No hay código de servidor.

Una sola vez, en el panel de Cloudflare (la misma cuenta de jorgegrajales.dev):

1. **Workers & Pages → Create application → Import a repository** y elige `gethilvana/hilvana`.
2. **Set up your application**:

   | Campo | Valor |
   |---|---|
   | Project name | `hilvana` |
   | Build command | `npm run build && npm run build:web` |
   | Deploy command | `npx wrangler deploy` |
   | Non-production branch deploy command | `npx wrangler versions upload` |
   | Path (root directory) | `/` |
   | Enable Preview builds | Activado (cada PR recibe una URL de prueba) |
   | Protect with Cloudflare Access | Desactivado (el sitio es público) |
   | Variables › Variable name / value | `NODE_VERSION` / `22` |
   | API token | *Create new token* (lo usa Cloudflare para desplegar desde GitHub) |

3. **Deploy**. Cuando termine: en el Worker, **Settings → Domains & Routes → Add → Custom domain** → `pdf.jorgegrajales.dev`. Como el dominio ya está en Cloudflare, el registro DNS se crea solo.
4. **Privacidad:** en la zona `jorgegrajales.dev`, **Rules → Configuration Rules → Create rule** con *Hostname equals* `pdf.jorgegrajales.dev`, y apaga **Rocket Loader** y **Email Obfuscation**. Inyectan scripts que la política de seguridad bloquearía. No actives Web Analytics para este sitio.

Desde ahí, cada cambio que se una a `main` se publica solo.

> **Web Analytics de Cloudflare:** si la zona tiene la configuración automática activada (por ejemplo, por el sitio personal), Cloudflare inyecta su script también en este subdominio. La política lo bloquea, pero no debe estar. Desactiva la configuración automática de la zona y activa la analítica solo en el proyecto del sitio personal (o con el fragmento manual en su código). Verifícalo abriendo la página con la pestaña Red: el único dominio debe ser `pdf.jorgegrajales.dev`.

### Comprobar la publicación

- `curl -sI https://pdf.jorgegrajales.dev | grep -i content-security-policy` debe mostrar la política con `frame-ancestors 'none'`.
- En el navegador, con las herramientas de desarrollo abiertas en la pestaña Red, procesar un archivo no debe generar peticiones fuera de `pdf.jorgegrajales.dev`.

## Tamaño

- App inicial: ~160 KB comprimidos (interfaz + vistas previas).
- Motor (*worker*): ~1,4 MB sin comprimir; se carga al agregar el primer archivo.
- Fuentes para Word y sellos (~3,8 MB en total): se descargan solo las que un documento necesita y quedan guardadas para usarlas sin conexión.
