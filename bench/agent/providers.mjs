// Calls to model providers. Only the request text and input names, kinds and page counts are sent
// (see prompt.mjs); no document leaves the machine. This file is benchmark tooling: the product
// packages never make network calls.
import { referenceAnswer } from './reference.mjs';

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} to run this model.`);
  return v;
};

/** OpenAI-compatible chat completions endpoints, keyed by provider. */
const OPENAI_COMPATIBLE = {
  'workers-ai': () => ({ url: `https://api.cloudflare.com/client/v4/accounts/${env('CLOUDFLARE_ACCOUNT_ID')}/ai/v1/chat/completions`, key: env('CLOUDFLARE_API_TOKEN') }),
  groq: () => ({ url: 'https://api.groq.com/openai/v1/chat/completions', key: env('GROQ_API_KEY') }),
  openai: () => ({ url: 'https://api.openai.com/v1/chat/completions', key: env('OPENAI_API_KEY') }),
  mistral: () => ({ url: 'https://api.mistral.ai/v1/chat/completions', key: env('MISTRAL_API_KEY') }),
  gemini: () => ({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: env('GEMINI_API_KEY') }),
  openrouter: () => ({ url: 'https://openrouter.ai/api/v1/chat/completions', key: env('OPENROUTER_API_KEY') }),
  ollama: () => ({ url: `${process.env.OLLAMA_HOST ?? 'http://localhost:11434'}/v1/chat/completions`, key: 'ollama' }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, headers, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      await sleep(Math.min(wait, 60_000));
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * Asks a model for a plan. Returns { text, inputTokens, outputTokens }.
 * `model` is an entry of models.json; `system` and `user` come from prompt.mjs.
 */
export async function ask(model, { system, user, testCase }) {
  if (model.provider === 'reference') return { text: referenceAnswer(testCase), inputTokens: 0, outputTokens: 0 };

  if (model.provider === 'anthropic') {
    const data = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }, {
      model: model.model,
      max_tokens: model.maxTokens ?? 2000,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return {
      text: (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }

  const endpoint = OPENAI_COMPATIBLE[model.provider];
  if (!endpoint) throw new Error(`Unknown provider ${model.provider}`);
  const { url, key } = endpoint();
  const body = {
    model: model.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: model.maxTokens ?? 4000, // reasoning models spend part of it thinking
    ...(model.temperature === null ? {} : { temperature: model.temperature ?? 0 }),
    ...(model.jsonMode === false ? {} : { response_format: { type: 'json_object' } }),
  };
  const data = await post(url, { authorization: `Bearer ${key}` }, body);
  const choice = data.choices?.[0]?.message ?? data.result?.choices?.[0]?.message;
  return {
    text: typeof choice?.content === 'string' ? choice.content : '',
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}
