import { readFileSync, writeFileSync } from 'node:fs';
import { signWithCertificate } from '../src/index.ts';
const orig = new Uint8Array(readFileSync('/tmp/c5/firmado-restringido.pdf'));
const res = await signWithCertificate(orig, { certificate: new Uint8Array(readFileSync('test/fixtures/certificates/luis.p12')), password: 'clave-luis' });
writeFileSync('/tmp/c5/c6.pdf', res.bytes);
const t = new TextDecoder('latin1').decode(res.bytes);
console.log(orig.length, res.bytes.length, [...t.matchAll(/(\d+) 0 obj/g)].filter(m => t.indexOf(m[0]) >= 0).map(m => m[1] + '@' + m.index).join(' '));
