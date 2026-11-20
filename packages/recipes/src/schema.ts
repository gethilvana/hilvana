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
    filename: z.string().max(200).optional().describe('Supports {date} and {name} (first input without extension).'),
  }).strict().optional(),
  goals: Goals.optional(),
}).strict();
export type Recipe = z.infer<typeof Recipe>;

/** JSON Schema for agents and editors. */
export const recipeJsonSchema = () => z.toJSONSchema(Recipe);

/** Steps that drop content or overwrite information; running them requires explicit confirmation. */
export const DESTRUCTIVE_OPS = new Set<Step['op']>(['select', 'remove', 'stripMetadata', 'setMetadata']);
