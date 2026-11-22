// Tests read PDFs with pdf.js 6, which needs Promise.withResolvers (built in from Node.js 22).
// The engine adds it itself before using pdf.js; tests that use pdf.js directly need it too.
import { ensurePromiseWithResolvers } from './packages/core/src/redact.js';

ensurePromiseWithResolvers();
