Encrypted copies of `packages/web/e2e/fixtures/factura-noviembre.pdf` (3 pages), made with qpdf:

| File | Opens without a password | Password | Method |
|---|---|---|---|
| permisos-aes256.pdf | yes (restrictions only) | — | AES-256, no modify/extract, low-res print |
| permisos-aes128.pdf | yes | — | AES-128 |
| permisos-rc4-128.pdf | yes | — | RC4-128 |
| permisos-rc4-40.pdf | yes | — | RC4-40 |
| permisos-aes256-objstm.pdf | yes | — | AES-256 with object streams |
| contrasena-aes256.pdf | no | `abierto` | AES-256 |
| contrasena-rc4-128.pdf | no | `abierto` | RC4-128 |
| certificado-no-soportado.pdf | — | — | AES-128 with the handler renamed to `/PubSec__`, standing in for certificate-based encryption (not supported) |

The owner password of every file is `dueno`.
