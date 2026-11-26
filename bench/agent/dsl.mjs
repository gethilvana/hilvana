// Small vocabulary for writing what a case expects. A plain value must be equal; these helpers
// describe the cases where several answers are right. The grader (grade.mjs) interprets them and
// can also turn them into a reference answer (reference.mjs), which keeps the corpus honest.

/** Inputs as the planner sees them: name, kind, pages and size. No content. */
export const pdf = (name, pages, extra = {}) => ({ name, kind: 'pdf', pages, ...extra });
export const word = (name, pages) => ({ name, kind: 'word', pages });
export const img = (name) => ({ name, kind: 'image' });
export const cert = (name) => ({ name, kind: 'certificate' });

/** Any of these values; `undefined` means the field may be left out. */
export const oneOf = (...values) => ({ $in: values });
/** A number in [lo, hi]. */
export const between = (lo, hi) => ({ $between: [lo, hi] });
/** A string containing every fragment (case and accents ignored). */
export const has = (...parts) => ({ $has: parts });
/** Present, any value. */
export const present = { $present: true };
/** Not present. */
export const absent = { $absent: true };
/** The same members in any order (enums such as redact patterns). */
export const setOf = (...values) => ({ $set: values });
/** Redaction terms: same set, case, accents and number punctuation ignored. */
export const terms = (...values) => ({ $terms: values });
/** Split ranges in any order (each range compared by the pages it covers). */
export const rangesAnyOrder = (...ranges) => ({ $rangesAnyOrder: ranges });

/** Steps that may come in any order among themselves. */
export const anyOrder = (...steps) => ({ $anyOrder: steps });
/** Several acceptable answers; the case passes if one matches. */
export const either = (...expectations) => ({ $either: expectations });

/** A case. `expect` is one of: { steps, goals?, output?, size?, passwordOnDevice? }, an either(...), or { outcome: 'question' | 'unsupported' }. */
export const c = (id, lang, category, instruction, inputs, expect, extra = {}) => ({ id, lang, category, instruction, inputs, expect, ...extra });
export const ask = { outcome: 'question' };
export const unsupported = { outcome: 'unsupported' };
