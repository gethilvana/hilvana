import { z } from 'zod';

const pages = z.string().min(1).describe('Page range, 1-based: "1-3,5", "last", "last-1", "4-last", "odd", "even", "all".');
const anchor = z.enum(['top-left', 'top-right', 'top-center', 'bottom-left', 'bottom-right', 'bottom-center', 'center']);
const color = z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('Hex color, e.g. "#1f3864".');

/** Source steps create the working document. If a recipe starts with any other step, all PDF inputs are merged first. */
export const MergeStep = z.object({
  op: z.literal('merge'),
  files: z.array(z.string()).min(1).optional().describe('Input names to merge, in order. Defaults to every PDF input in the order given.'),
}).strict();

export const FromImagesStep = z.object({
  op: z.literal('fromImages'),
  files: z.array(z.string()).min(1).optional().describe('Image input names (PNG/JPEG). Defaults to every image input.'),
  pageSize: z.enum(['image', 'a4', 'letter']).optional(),
}).strict();

export const SelectStep = z.object({ op: z.literal('select'), pages }).strict()
  .describe('Keep only these pages, in this order. Drops the rest.');
export const RemoveStep = z.object({ op: z.literal('remove'), pages }).strict()
  .describe('Delete these pages.');
export const RotateStep = z.object({
  op: z.literal('rotate'),
  angle: z.union([z.literal(90), z.literal(180), z.literal(270), z.literal(-90)]),
  pages: pages.optional(),
}).strict();
export const StampTextStep = z.object({
  op: z.literal('stampText'),
  text: z.string().min(1).describe('Text to add. "{date}" is replaced by today\'s date (YYYY-MM-DD).'),
  pages: pages.optional(),
  anchor: anchor.optional(),
  size: z.number().positive().max(200).optional(),
  color: color.optional(),
}).strict();
export const SignStep = z.object({
  op: z.literal('sign'),
  image: z.string().describe('Name of the image input with the signature (PNG with transparency works best).'),
  pages: pages.optional().describe('Defaults to "last".'),
  anchor: anchor.optional(),
  width: z.number().positive().max(600).optional(),
}).strict();
export const WatermarkStep = z.object({
  op: z.literal('watermark'),
  text: z.string().min(1),
  pages: pages.optional(),
  opacity: z.number().min(0.05).max(1).optional(),
  color: color.optional(),
}).strict();
export const NumberPagesStep = z.object({
  op: z.literal('numberPages'),
  format: z.string().optional().describe('Supports {n} and {total}, e.g. "Página {n} de {total}".'),
  anchor: anchor.optional(),
  pages: pages.optional(),
}).strict();
export const StripMetadataStep = z.object({ op: z.literal('stripMetadata') }).strict();
export const SetMetadataStep = z.object({
  op: z.literal('setMetadata'),
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
}).strict();
export const OptimizeStep = z.object({ op: z.literal('optimize') }).strict()
  .describe('Lossless optimization (same as compress with level "lossless").');
export const CompressStep = z.object({
  op: z.literal('compress'),
  level: z.enum(['lossless', 'balanced', 'strong', 'max']).optional()
    .describe('lossless: no image changes. balanced: images at 150 dpi (default). strong: 110 dpi. max: 72 dpi. Text and vectors are never rasterized.'),
  targetBytes: z.number().int().positive().optional()
    .describe('Try stronger levels until the file is at most this size. Defaults to goals.maxBytes when no level is given.'),
}).strict();

export const SplitStep = z.object({
  op: z.literal('split'),
  ranges: z.array(pages).min(1).max(500).optional()
    .describe('One output file per range, in order (e.g. ["1-3", "4-last"]). Omit for one file per page.'),
}).strict().describe('Last step only: splits the document into several output files.');

export const RedactStep = z.object({
  op: z.literal('redact'),
  terms: z.array(z.string().min(1).max(200)).max(200).optional()
    .describe('Words or numbers to remove wherever they appear. Numbers match with or without spaces, dots or dashes. Case and accents are ignored.'),
  patterns: z.array(z.enum(['email', 'card', 'number', 'phone'])).max(4).optional()
    .describe('Kinds of personal data to find: email addresses, card numbers (checked with Luhn), numbers of 6 or more digits (accounts, IDs; amounts with decimals are left alone), phone numbers.'),
  areas: z.array(z.object({
    page: z.number().int().positive(),
    x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  }).strict()).max(500).optional().describe('Rectangles to remove, in PDF points from the bottom-left corner of the page. Use them for scanned pages, photos and signatures.'),
}).strict().describe('Real redaction: removes the text, image pixels and shapes under each match or area from the file, then covers them with black boxes. The result is checked by reading its text again.');

export const ProtectStep = z.object({
  op: z.literal('protect'),
  password: z.string().min(1).max(128).optional()
    .describe('Password needed to open the result. Secret: never send it through an AI model; people type it on their own device.'),
  allowPrint: z.boolean().optional().describe('Defaults to true.'),
  allowCopy: z.boolean().optional().describe('Allow copying text and images. Defaults to true.'),
  allowModify: z.boolean().optional().describe('Allow changes, annotations, form filling and page assembly. Defaults to true.'),
}).strict().describe('Last step only: encrypts the result (AES-256) with a password and/or usage restrictions.');

export const SignDigitalStep = z.object({
  op: z.literal('signDigital'),
  certificate: z.string().describe('Name of the .p12/.pfx input with the certificate. Its password is given with that input, never in the recipe.'),
  reason: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  visible: z.boolean().optional().describe('Write a line "Digitally signed by …" on the page. Defaults to true; skipped when the document already has signatures, so they stay valid.'),
  pages: pages.optional().describe('Where the visible line goes. Defaults to "last".'),
  anchor: anchor.optional().describe('Defaults to "bottom-right".'),
}).strict().describe('Last step only: signs the result with a digital certificate (PAdES B-B). The private key never leaves the device.');

export const Step = z.discriminatedUnion('op', [
  MergeStep,
  FromImagesStep,
  SelectStep,
  RemoveStep,
  RotateStep,
  StampTextStep,
  SignStep,
  WatermarkStep,
  NumberPagesStep,
  StripMetadataStep,
  SetMetadataStep,
  OptimizeStep,
  CompressStep,
  SplitStep,
  RedactStep,
  ProtectStep,
  SignDigitalStep,
]);
export type Step = z.infer<typeof Step>;

export const Goals = z.object({
  maxBytes: z.number().int().positive().optional().describe('The result must be at most this many bytes.'),
  pageCount: z.number().int().positive().optional().describe('The result must have exactly this many pages.'),
  maxPages: z.number().int().positive().optional(),
  noMetadata: z.boolean().optional().describe('The result must carry no identifying metadata.'),
}).strict();
export type Goals = z.infer<typeof Goals>;

export const Recipe = z.object({
  version: z.literal(1),
  name: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  steps: z.array(Step).min(1).max(50),
  output: z.object({
    filename: z.string().max(200).optional().describe('Supports {date} and {name} (first input without extension). With a final split step, each part adds "-<range>" (or "-<page>") before .pdf.'),
  }).strict().optional(),
  goals: Goals.optional(),
}).strict();
export type Recipe = z.infer<typeof Recipe>;

/** JSON Schema for agents and editors. */
export const recipeJsonSchema = () => z.toJSONSchema(Recipe);

/** Steps that drop content or overwrite information; running them requires explicit confirmation. */
export const DESTRUCTIVE_OPS = new Set<Step['op']>(['select', 'remove', 'stripMetadata', 'setMetadata', 'redact']);

/** Steps that produce the final file(s); a recipe can end with at most one of them. */
export const FINAL_OPS = new Set<Step['op']>(['split', 'protect', 'signDigital']);

/** Steps that carry or use a secret: surfaces that route through an AI model must not run them. */
export const SECRET_OPS = new Set<Step['op']>(['signDigital']);

/** A copy of the recipe that is safe to show or share: passwords are replaced. */
export function redactRecipe<T extends { steps: { op: string }[] }>(recipe: T): T {
  return {
    ...recipe,
    steps: recipe.steps.map((s) => (s.op === 'protect' && 'password' in s && s.password ? { ...s, password: '••••••' } : s)),
  };
}
