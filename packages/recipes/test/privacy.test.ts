import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { run } from '@hilvana/recipes';
import { sampleContract } from '../../office/test/fixtures.js';
import { TINY_PNG, makePdf } from '../../core/test/helpers.js';

/**
 * Privacy guarantee as a test: run a full recipe (Word conversion, stamps with fallback fonts,
 * signature, compression, metadata removal) with every network entry point rigged to fail the test.
 */
describe('privacy: no network access', () => {
  const attempts: string[] = [];
  const block = (name: string) => (..._args: unknown[]) => { attempts.push(name); throw new Error(`network call attempted: ${name}`); };

  beforeAll(() => {
    vi.spyOn(net, 'connect').mockImplementation(block('net.connect') as never);
    vi.spyOn(net, 'createConnection').mockImplementation(block('net.createConnection') as never);
    vi.spyOn(tls, 'connect').mockImplementation(block('tls.connect') as never);
    vi.spyOn(dns, 'lookup').mockImplementation(block('dns.lookup') as never);
    vi.spyOn(http, 'request').mockImplementation(block('http.request') as never);
    vi.spyOn(https, 'request').mockImplementation(block('https.request') as never);
    vi.stubGlobal('fetch', block('fetch'));
  });
  afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('runs a full recipe without touching the network', async () => {
    const files = [
      { name: 'contrato.docx', bytes: await sampleContract() },
      { name: 'anexo.pdf', bytes: await makePdf(2, { author: 'Ana' }) },
      { name: 'firma.png', bytes: TINY_PNG },
    ];
    const recipe = {
      version: 1,
      steps: [
        { op: 'merge', files: ['contrato.docx', 'anexo.pdf'] },
        { op: 'stampText', text: '✓ Recibido {date} — Ελλάδα', pages: '1', anchor: 'top-right' },
        { op: 'watermark', text: 'CONFIDENCIAL' },
        { op: 'numberPages', format: 'Página {n} de {total}' },
        { op: 'sign', image: 'firma.png' },
        { op: 'compress' },
        { op: 'stripMetadata' },
      ],
      goals: { pageCount: 4, noMetadata: true, maxBytes: 2_000_000 },
    };
    const res = await run(recipe, files, { confirmed: true });
    expect(res.allGoalsMet).toBe(true);
    expect(attempts).toEqual([]);
  }, 60_000);
});
