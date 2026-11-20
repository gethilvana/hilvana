#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FolderGuard } from './fsguard.js';
import { VERSION, createServer } from './server.js';

const HELP = `hilvana-mcp ${VERSION}: MCP server for private, local PDF workflows.

Usage:
  hilvana-mcp --root <folder> [--root <folder> ...] [--lang es|en]

Only files inside the given folders can be read or written.
You can also set HILVANA_ROOTS (separated by "${path.delimiter}").
`;

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', multiple: true },
      lang: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(VERSION + '\n');

  const roots = [...(values.root ?? []), ...(process.env.HILVANA_ROOTS?.split(path.delimiter).filter(Boolean) ?? [])];
  if (roots.length === 0) {
    process.stderr.write('hilvana-mcp: no folder authorized. Pass --root <folder> or set HILVANA_ROOTS.\n');
    process.exit(2);
  }
  const lang = values.lang === 'en' ? 'en' : values.lang === 'es' ? 'es' : undefined;
  const guard = await FolderGuard.create(roots);
  const server = createServer(guard, { lang });
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; diagnostics go to stderr.
  process.stderr.write(`hilvana-mcp ${VERSION} ready. Allowed folders: ${guard.roots.join(', ')}\n`);
}

main().catch((err) => {
  process.stderr.write(`hilvana-mcp: ${(err as Error).message}\n`);
  process.exit(1);
});
