#!/usr/bin/env node
// Fetches the public corpus at pinned commits into bench/.cache (not committed) and writes
// bench/corpus.json: every file used, with its source, license and SHA-256, so anyone can check
// they run the same benchmark.
//
// Sources:
// - Apache POI test documents (Apache-2.0 repository): Word files collected over 20 years of bug
//   reports, many of them unusual on purpose.
// - pdf.js test PDFs (Apache-2.0 repository): real-world PDFs that once broke a reader.
// Files keep their original authors' rights; they are fetched from their source, not redistributed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const cache = path.join(root, '.cache');
mkdirSync(cache, { recursive: true });

const SOURCES = [
  { id: 'poi', repo: 'https://github.com/apache/poi.git', commit: 'c94ee8ad9096bdb8cf8e5e59d8d12432e950dbf3', dir: 'test-data/document', license: 'Apache-2.0 repository; documents keep their authors\' rights' },
  { id: 'pdfjs', repo: 'https://github.com/mozilla/pdf.js.git', commit: '541d197e6b455341697496f24b1e00a88061f3eb', dir: 'test/pdfs', license: 'Apache-2.0 repository; documents keep their authors\' rights' },
];

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function fetchSource(s) {
  const dest = path.join(cache, s.id);
  if (!existsSync(path.join(dest, '.git'))) {
    execFileSync('git', ['init', '-q', dest]);
    execFileSync('git', ['-C', dest, 'remote', 'add', 'origin', s.repo]);
    execFileSync('git', ['-C', dest, 'sparse-checkout', 'set', s.dir]);
  }
  execFileSync('git', ['-C', dest, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', s.commit], { stdio: 'inherit' });
  execFileSync('git', ['-C', dest, 'checkout', '-q', s.commit]);
  return path.join(dest, s.dir);
}

const files = [];
for (const s of SOURCES) {
  const dir = fetchSource(s);
  const ext = s.id === 'poi' ? '.docx' : '.pdf';
  let names = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext)).sort();
  if (s.id === 'pdfjs') {
    // A fixed, unbiased sample: the 200 files under 4 MB whose hashes sort first.
    names = names
      .filter((f) => statSync(path.join(dir, f)).size < 4 * 1024 * 1024)
      .map((f) => ({ f, h: sha(path.join(dir, f)) }))
      .sort((a, b) => a.h.localeCompare(b.h))
      .slice(0, 200)
      .map((x) => x.f)
      .sort();
  }
  for (const f of names) {
    const p = path.join(dir, f);
    files.push({ source: s.id, name: f, path: path.relative(root, p), bytes: statSync(p).size, sha256: sha(p) });
  }
}
writeFileSync(path.join(root, 'corpus.json'), JSON.stringify({ sources: SOURCES, files }, null, 2) + '\n');
console.log(`${files.length} files: ${SOURCES.map((s) => `${files.filter((f) => f.source === s.id).length} from ${s.id}`).join(', ')}`);
