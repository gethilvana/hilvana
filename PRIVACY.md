# Privacidad · Privacy

## Español

Hilvana está diseñado para que tus documentos no salgan de tu equipo.

**Lo que hace hoy (v0.1)**

- La CLI y el servidor MCP procesan todo localmente. No hacen ninguna conexión de red.
- El servidor MCP le devuelve al agente solo **estructura**: número de páginas, tamaños, rotación, si el archivo está protegido y qué campos de metadatos existen. Nunca devuelve el texto ni las imágenes de las páginas.
- El servidor MCP solo lee y escribe dentro de las carpetas que autorizas con `--root`, después de resolver enlaces simbólicos.
- Ningún archivo de entrada se modifica. Los resultados van a un archivo nuevo.
- La conversión de Word a PDF también es local: con el motor propio, o con LibreOffice instalado en tu equipo si eliges ese motor. LibreOffice se ejecuta con un perfil temporal que se borra al terminar.
- No hay analítica ni telemetría.

**Lo que viene (y cómo se va a manejar)**

- *Agente integrado en la web:* el modelo de IA recibirá solo tu instrucción y metadatos mínimos, nunca el contenido del documento. Solo se usarán proveedores con retención de datos cero o mínima, sin uso para entrenamiento; la política vigente de cada proveedor se publicará aquí.
- *Modo servidor (opcional):* para operaciones pesadas. Será siempre explícito, con procesamiento efímero y sin retención.

## English

Hilvana is designed so your documents never leave your machine.

- The CLI and MCP server process everything locally and make no network connections.
- The MCP server returns only **structure** to the agent (page count, sizes, rotation, encryption, which metadata fields exist), never page text or images.
- The MCP server only reads and writes inside the folders you authorize with `--root`, after resolving symlinks.
- Inputs are never modified; results go to a new file.
- No analytics or telemetry.

Upcoming hosted features (web agent, optional server mode) will send at most your instruction and minimal metadata to a model provider with zero or minimal data retention and no training use, and will process files ephemerally when you explicitly opt in.
