// A reference answer for each case, built from what the case expects. It is what a perfect planner
// would answer, so `run.mjs --model reference` must score 100 %: that checks the corpus itself
// (valid page ranges, input names, final steps) every time the tests run.

function value(want, key) {
  if (want && typeof want === 'object' && !Array.isArray(want)) {
    if ('$in' in want) return want.$in.find((v) => v !== undefined);
    if ('$between' in want) return Math.round(((want.$between[0] + want.$between[1]) / 2) * 100) / 100;
    if ('$has' in want) return want.$has.join(' ');
    if ('$present' in want) return key === 'color' ? '#1f7a3a' : 'x';
    if ('$absent' in want) return undefined;
    if ('$set' in want) return [...want.$set];
    if ('$terms' in want) return [...want.$terms];
    if ('$rangesAnyOrder' in want) return [...want.$rangesAnyOrder];
    return Object.fromEntries(Object.entries(want).map(([k, v]) => [k, value(v, k)]).filter(([, v]) => v !== undefined));
  }
  if (Array.isArray(want)) return want.map((v) => value(v));
  return want;
}

const flatten = (steps) => steps.flatMap((s) => (s.$anyOrder ? s.$anyOrder : [s]));

export function referenceAnswer(testCase) {
  const expect = testCase.expect.$either ? testCase.expect.$either[0] : testCase.expect;
  if (expect.outcome) {
    const kind = value(expect.outcome);
    return JSON.stringify({ [kind]: kind === 'question' ? '¿Qué páginas o datos exactamente?' : 'Hilvana no hace eso.' });
  }
  const recipe = { version: 1, steps: flatten(expect.steps).map((s) => value(s)) };
  if (expect.size) recipe.goals = { maxBytes: Math.round((expect.size[0] + expect.size[1]) / 2) };
  if (expect.goals) recipe.goals = { ...recipe.goals, ...value(expect.goals) };
  if (expect.output) recipe.output = value(expect.output);
  return JSON.stringify({ recipe, ...(expect.passwordOnDevice ? { passwordOnDevice: true } : {}) });
}
