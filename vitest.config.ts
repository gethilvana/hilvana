import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@hilvana/core': r('./packages/core/src/index.ts'),
      '@hilvana/recipes': r('./packages/recipes/src/index.ts'),
      '@hilvana/office': r('./packages/office/src/index.ts'),
    },
  },
  // Font embedding and real PDFs are slow on shared Windows/macOS runners.
  test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: 30_000 },
});
