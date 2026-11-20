#!/usr/bin/env node
// Fails if any installed production dependency uses a copyleft license that would
// impose obligations on a hosted service (AGPL) or on distribution (GPL/LGPL/SSPL).
// Hilvana is MIT; see docs/licenses.md for the policy.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const BLOCKED = /\b(AGPL|GPL|LGPL|SSPL|EUPL|OSL|CC-BY-NC)/i;
const root = process.cwd();
const seen = new Map();

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object') return pkg.license.type ?? 'UNKNOWN';
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

// Walk production dependencies of every workspace package, transitively.
function walk(name, fromDir) {
  let dir = fromDir;
  let pkgDir;
  while (true) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) { pkgDir = candidate; break; }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
  if (seen.has(pkgDir)) return;
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  seen.set(pkgDir, { name: pkg.name, version: pkg.version, license: licenseOf(pkg) });
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, pkgDir);
}

const workspaces = readdirSync(path.join(root, 'packages')).map((d) => path.join(root, 'packages', d));
for (const ws of workspaces) {
  const pkg = JSON.parse(readFileSync(path.join(ws, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep.startsWith('@hilvana/')) continue;
    walk(dep, ws);
  }
}

const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
// "X OR MIT" style dual licenses are fine as long as one option is permissive.
const bad = rows.filter((r) => BLOCKED.test(r.license) && !/\bOR\b/i.test(r.license));
const unknown = rows.filter((r) => r.license === 'UNKNOWN');

console.log(`Checked ${rows.length} production dependencies.`);
for (const r of unknown) console.warn(`⚠ unknown license: ${r.name}@${r.version}`);
if (bad.length) {
  for (const r of bad) console.error(`✗ blocked license ${r.license}: ${r.name}@${r.version}`);
  process.exit(1);
}
console.log('✓ No copyleft licenses in production dependencies.');
