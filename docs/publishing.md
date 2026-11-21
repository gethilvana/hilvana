# Publicar en npm

Los cinco paquetes se publican solos desde GitHub Actions cuando se sube una etiqueta de versión (`v0.1.0`). Cada versión queda con **procedencia** (*provenance*): npm muestra que se construyó desde este repositorio y este flujo, no desde un computador cualquiera.

| Paquete | Para qué |
|---|---|
| `@hilvana/core` | Motor PDF |
| `@hilvana/office` | Word → PDF |
| `@hilvana/recipes` | Recetas |
| `hilvana` | CLI (`npx hilvana ...`) |
| `hilvana-mcp` | Servidor MCP (`npx -y hilvana-mcp ...`) |

## Una sola vez

1. **Cuenta de npm.** Crea una en npmjs.com y activa la verificación en dos pasos (*Account → Two-Factor Authentication*, modo "Authorization and writes").
2. **Organización `hilvana`.** En npmjs.com: *Add Organization* → nombre `hilvana` → plan gratuito (paquetes públicos). Es la que permite publicar `@hilvana/...`.
   - Si el nombre ya estuviera tomado, usa `gethilvana` y cambia `@hilvana/` por `@gethilvana/` en los `package.json` (Claude puede hacerlo).
3. **Publicación de confianza (*trusted publishing*).** No se guarda ningún token: GitHub Actions obtiene una credencial de un solo uso en cada publicación. En npmjs.com, para **cada uno** de los cinco paquetes: *Settings → Trusted Publisher → GitHub Actions* y llena:

   | Campo | Valor |
   |---|---|
   | Organization or user | `gethilvana` |
   | Repository | `hilvana` |
   | Workflow filename | `release.yml` |
   | Environment name | (vacío) |

   Luego, en la misma página, *Publishing access → Require two-factor authentication and disallow tokens*.
   - npm solo permite configurarlo en paquetes que ya existen. Para un paquete **nuevo**, publícalo una vez con un token granular temporal (*Read and write*, *Bypass 2FA*, vencimiento corto, secreto `NPM_TOKEN` con `NODE_AUTH_TOKEN` en el paso de publicar), configura el *trusted publisher* y borra el token y el secreto.

## Cada versión

1. Cambia `version` en los cinco `package.json` y en las dependencias internas (`"@hilvana/core": "0.2.0"`, etc.). Claude puede hacerlo.
2. Une los cambios a `main`.
3. Crea la etiqueta, desde GitHub (*Releases → Draft a new release → Choose a tag: v0.2.0*) o en la terminal:
   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```
4. El flujo *Release* compila, corre las pruebas y la política de licencias, verifica que la etiqueta coincida con las versiones y publica en orden.

## Después de publicar

- La configuración de Claude Desktop se simplifica (ya no hace falta clonar):
  ```json
  { "mcpServers": { "hilvana": { "command": "npx", "args": ["-y", "hilvana-mcp", "--root", "C:/Users/Gooni/OneDrive/Documentos/PDFs", "--lang", "es"] } } }
  ```
- Siguiente paso de distribución: inscribir `hilvana-mcp` en el registro oficial de servidores MCP y en directorios comunitarios.
