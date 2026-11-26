// Stand-in files for the corpus inputs, so plan() can check each answer against real page counts,
// kinds and protections. Their content does not matter: the planner never sees it.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { encode } from 'fast-png';
import { Document, Packer, Paragraph, PageBreak } from 'docx';
import { protect } from '@hilvana/core';

const cache = new Map();

async function makePdf(pages) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([612, 792]).drawText(`Page ${i}`, { x: 72, y: 700, size: 14, font });
  return doc.save();
}

function makePng() {
  const width = 8, height = 8;
  return encode({ width, height, data: new Uint8Array(width * height * 4).fill(200), channels: 4 });
}

async function makeDocx(pages) {
  const children = [];
  for (let i = 1; i <= pages; i++) {
    children.push(new Paragraph({ text: `Página ${i}` }));
    if (i < pages) children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

async function build(input) {
  switch (input.kind) {
    case 'pdf': {
      const bytes = await makePdf(input.pages);
      if (input.protected === 'permissions') return protect(bytes, { allowCopy: false, allowModify: false });
      if (input.protected === 'password') return protect(bytes, { password: input.password });
      return bytes;
    }
    case 'word': return makeDocx(input.pages);
    case 'image': return makePng();
    case 'certificate': return new Uint8Array(64); // never opened: certificate cases expect a refusal
    default: throw new Error(`Unknown input kind ${input.kind}`);
  }
}

/** InputFile[] for plan(): the bytes plus, for password-protected inputs, the password the person would type on their device. */
export async function fixtures(inputs) {
  const out = [];
  for (const input of inputs) {
    const key = JSON.stringify([input.kind, input.pages, input.protected, input.password]);
    if (!cache.has(key)) cache.set(key, build(input));
    out.push({ name: input.name, bytes: await cache.get(key), ...(input.password ? { password: input.password } : {}) });
  }
  return out;
}
