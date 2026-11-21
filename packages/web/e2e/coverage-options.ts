// Shared by the per-test collector (test.ts) and the final report (coverage-report.ts).
export const coverageOptions = {
  name: 'Hilvana web: code run by the browser tests',
  outputDir: './coverage-e2e',
  reports: ['console-summary', 'html', 'json-summary'],
  sourceFilter: (p: string) => p.includes('src/') && !p.includes('node_modules'),
};
