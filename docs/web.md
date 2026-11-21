# Aplicación web

`packages/web` es Hilvana en el navegador. Usa el mismo motor que la CLI y el servidor MCP (`@hilvana/core`, `@hilvana/office`, `@hilvana/recipes`), así que lo que funciona en un lado funciona en el otro.

## Privacidad, comprobable

- **Todo se procesa en el navegador**, en un *Web Worker*. No hay servidor que reciba archivos.
- **La página solo puede conectarse a su propio dominio.** La política de seguridad (`Content-Security-Policy`) va en una etiqueta `<meta>` del HTML y como cabecera HTTP (`dist/_headers`). El navegador bloquea cualquier otra conexión: analítica, CDNs o APIs. Las únicas peticiones son los archivos de la propia app y sus fuentes tipográficas.
- **Funciona sin conexión** después de la primera visita, gracias a un *service worker* que guarda la app. Los documentos nunca pasan por él.
- Las vistas previas de páginas usan pdf.js (Apache-2.0), solo para dibujar. Todos los cambios a los documentos los hace el motor de Hilvana.

Las pruebas de navegador (`packages/web/e2e/privacy.spec.ts`) verifican la política, que un `fetch` a otro dominio queda bloqueado y que la app funciona sin conexión.

## Herramientas

| Grupo | Herramienta | Paso de receta |
|---|---|---|
| Unir y ordenar | Unir PDF (incluye Word) | `merge` |
| | Organizar páginas (quitar, reordenar) | `select` |
| | Dividir (por página o por rangos, con .zip) | `core.split` / `core.burst` |
| | Girar páginas | `rotate` |
| Convertir | Word a PDF | `.docx` en `merge` |
| | Imágenes a PDF | `fromImages` |
| Firmar y marcar | Firmar (dibujada o imagen) | `sign` |
| | Sello de texto | `stampText` |
| | Numerar páginas | `numberPages` |
| | Marca de agua | `watermark` |
| Reducir y limpiar | Comprimir | `compress` |
| | Quitar metadatos | `stripMetadata` |

Cada resultado ofrece **Ver como receta**: la misma acción en JSON, lista para `npx hilvana run` o para un agente con el servidor MCP.

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

## Publicar en pdf.jorgegrajales.dev (Cloudflare Pages)

Una sola vez, en el panel de Cloudflare (la misma cuenta de jorgegrajales.dev):

1. **Workers & Pages → Create → Pages → Connect to Git** y elige `gethilvana/hilvana`.
2. Configuración de compilación:

   | Campo | Valor |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `npm run build && npm run build:web` |
   | Build output directory | `packages/web/dist` |
   | Variable de entorno | `NODE_VERSION` = `22` |

3. Cuando termine la primera compilación: **Custom domains → Set up a custom domain** → `pdf.jorgegrajales.dev`. Como el dominio ya está en Cloudflare, el registro DNS se crea solo.
4. **Importante para la privacidad:** no actives *Web Analytics* en este proyecto, ni *Rocket Loader* o *Email Address Obfuscation* en la zona. Inyectan scripts que la política de seguridad bloquearía y que contradicen la promesa de la página.

Desde ahí, cada cambio que se una a `main` se publica solo, y cada PR recibe una URL de vista previa.

### Comprobar la publicación

- `curl -sI https://pdf.jorgegrajales.dev | grep -i content-security-policy` debe mostrar la política con `frame-ancestors 'none'`.
- En el navegador, con las herramientas de desarrollo abiertas en la pestaña Red, procesar un archivo no debe generar peticiones fuera de `pdf.jorgegrajales.dev`.

## Tamaño

- App inicial: ~160 KB comprimidos (interfaz + vistas previas).
- Motor (*worker*): ~1,4 MB sin comprimir; se carga al agregar el primer archivo.
- Fuentes para Word y sellos (~3,8 MB en total): se descargan solo las que un documento necesita y quedan guardadas para usarlas sin conexión.
