/** Intermediate document model produced by the .docx reader and consumed by the layout engine. All lengths are in PDF points. */

export interface RunStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string; // hex without '#'
  /** True when no explicit color was set (Word's "automatic"): it turns white on dark shading. */
  autoColor?: boolean;
  highlight?: string; // hex
  vertAlign?: 'superscript' | 'subscript';
  caps: boolean;
}

export type Inline =
  | { kind: 'text'; text: string; style: RunStyle }
  | { kind: 'tab'; style: RunStyle }
  | { kind: 'break'; style: RunStyle }
  | { kind: 'image'; bytes: Uint8Array; format: 'png' | 'jpg'; width: number; height: number };

export interface ParagraphStyle {
  align: 'left' | 'center' | 'right' | 'justify';
  spaceBefore: number;
  spaceAfter: number;
  /** Line height: a multiple of the font's natural line height, or an exact/minimum value in points. */
  line: { rule: 'auto'; value: number } | { rule: 'exact' | 'atLeast'; value: number };
  indentLeft: number;
  indentRight: number;
  /** Positive: first-line indent. Negative: hanging indent. */
  firstLine: number;
  pageBreakBefore: boolean;
  keepNext: boolean;
  contextualSpacing: boolean;
  styleId?: string;
  shading?: string;
  borderBottom?: { width: number; color: string };
}

export interface Paragraph {
  type: 'paragraph';
  style: ParagraphStyle;
  inlines: Inline[];
  /** List label such as "1." or "•", rendered in the hanging indent. */
  label?: { text: string; style: RunStyle };
}

export interface TableCell {
  blocks: Block[];
  span: number;
  /** "restart" starts a vertical merge, "continue" is covered by the cell above. */
  vMerge?: 'restart' | 'continue';
  shading?: string;
  vAlign: 'top' | 'center' | 'bottom';
  /** Per-side borders set on the cell itself; null means explicitly none. Absent sides follow the table. */
  borders?: Partial<Record<'top' | 'right' | 'bottom' | 'left', { width: number; color: string } | null>>;
}

export interface TableRow {
  cells: TableCell[];
  minHeight: number;
  header: boolean;
}

export interface Table {
  type: 'table';
  columns: number[];
  rows: TableRow[];
  borders: boolean;
  borderColor: string;
  indent: number;
  cellPadding: { top: number; right: number; bottom: number; left: number };
}

/** A page break; `section` is set when it ends a section, with that section's page setup. */
export type Block = Paragraph | Table | { type: 'pageBreak'; section?: PageSetup };

export interface PageSetup {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface Section {
  page: PageSetup;
  blocks: Block[];
}

export interface DocModel {
  /** Page setup of the last section (the document default). */
  page: PageSetup;
  blocks: Block[];
  /** The document split by section breaks, each with its own page size, orientation and margins. */
  sections: Section[];
  defaultTab: number;
  warnings: string[];
}
