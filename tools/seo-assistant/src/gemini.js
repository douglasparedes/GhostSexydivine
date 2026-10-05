import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

let client = null;

export const MODELS = [
  {
    id: 'gemini-3-flash-preview',
    label: 'Flash 3 (latest, balanced)',
    hint: 'Default: fast analysis and copy drafts',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Pro 3.1 (strongest reasoning)',
    hint: 'Slower, best judgment on tricky posts',
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    label: 'Flash-Lite 3.1 (cheapest)',
    hint: 'High-frequency audits on a budget',
  },
  { id: 'gemini-2.5-flash', label: 'Flash 2.5 (stable)', hint: 'Previous stable generation' },
  {
    id: 'gemini-2.5-pro',
    label: 'Pro 2.5 (stable reasoning)',
    hint: 'Previous stable generation, deeper',
  },
];

const MODEL_IDS = new Set(MODELS.map((model) => model.id));
export const DEFAULT_MODEL = 'gemini-3-flash-preview';

export function resolveModel(requested) {
  if (!requested) {
    return MODEL_IDS.has(config.geminiModel) ? config.geminiModel : DEFAULT_MODEL;
  }
  if (!MODEL_IDS.has(requested)) {
    throw new Error(`Unknown model "${requested}". Choose one of: ${[...MODEL_IDS].join(', ')}`);
  }
  return requested;
}

function isRetryable(error) {
  const status = error?.status ?? error?.code;
  if (status === 429 || status === 503) {
    return true;
  }
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('rate limit') ||
    message.includes('try again')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries transient model errors (429/503/demand spikes) with backoff, then
// raises a human-readable error naming the model so the UI can offer a retry
// or a different model instead of a raw API payload.
export async function withRetry(label, fn, { retries = 3, baseDelay = 1000 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !isRetryable(error)) {
        throw error;
      }
      const delay = baseDelay * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
      console.log(`${label}: attempt ${attempt} failed (${error.message}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

export function friendlyError(error, model) {
  if (isRetryable(error)) {
    return `The ${model} model is busy right now (high demand). Wait a moment and retry, or pick a different model — your audit data is safe.`;
  }
  return `Gemini request failed: ${error.message}`;
}

export function isConfigured() {
  return Boolean(config.geminiKey);
}

function getClient() {
  if (!isConfigured()) {
    throw new Error('Gemini is not configured. Set GEMINI_API_KEY.');
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: config.geminiKey });
  }
  return client;
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          current: { type: 'string' },
          proposed: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['field', 'proposed', 'reason'],
      },
    },
    content_suggestions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'fixes', 'content_suggestions'],
};

const WRITABLE_HINT = [
  'meta_title',
  'meta_description',
  'custom_excerpt',
  'feature_image_alt',
  'feature_image_caption',
  'canonical_url',
  'tags',
  'og_title',
  'og_description',
  'twitter_title',
  'twitter_description',
].join(', ');

export async function askQuestion(question, context, options = {}) {
  const model = resolveModel(options.model);
  const ai = getClient();
  const prompt = [
    'You are an SEO assistant for a Ghost publication. Answer the user question concisely.',
    'You can reference this workspace context (recent audit runs):',
    context,
    '',
    `Question: ${question}`,
  ].join('\n');
  const response = await withRetry('askQuestion', () =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: { maxOutputTokens: 1024 },
    }),
  ).catch((error) => {
    throw new Error(friendlyError(error, model));
  });
  return response.text ?? '';
}

export async function enrichAnalysis({ resource, resourceType, analysis, model: requestedModel }) {
  const model = resolveModel(requestedModel);
  const ai = getClient();
  const tags = (resource.tags ?? []).map((tag) => tag.name);
  const prompt = [
    'You are an SEO editor for a Ghost publication. Analyze this post/page and the deterministic findings.',
    'Propose concrete replacement copy ONLY for these writable fields:',
    WRITABLE_HINT + '.',
    'Never propose slug changes (they break URLs) and never rewrite the article body; put body advice in content_suggestions.',
    'Keep meta titles 30-60 chars and meta descriptions 120-158 chars.',
    '',
    `Resource type: ${resourceType}`,
    `Status: ${resource.status}`,
    `Title: ${resource.title ?? ''}`,
    `Slug: ${resource.slug ?? ''}`,
    `Excerpt: ${(resource.custom_excerpt ?? resource.excerpt ?? '').slice(0, 500)}`,
    `Tags: ${tags.join(', ')}`,
    `Stats: ${analysis.stats.words} words, headings ${JSON.stringify(analysis.stats.headings)}, links ${JSON.stringify(analysis.stats.links)}`,
    `Meta title: ${resource.meta_title ?? '(missing)'}`,
    `Meta description: ${(resource.meta_description ?? '(missing)').slice(0, 400)}`,
    `Canonical URL: ${resource.canonical_url ?? '(none)'}`,
    `Deterministic findings: ${JSON.stringify(analysis.findings)}`,
  ].join('\n');

  let response;
  try {
    response = await withRetry('enrichAnalysis', () =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: FIX_SCHEMA,
          maxOutputTokens: 2048,
        },
      }),
    );
  } catch (error) {
    throw new Error(friendlyError(error, model));
  }
  const text = response.text ?? '{}';
  try {
    const parsed = JSON.parse(text);
    return {
      summary: String(parsed.summary ?? ''),
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes : [],
      contentSuggestions: Array.isArray(parsed.content_suggestions)
        ? parsed.content_suggestions
        : [],
    };
  } catch {
    return { summary: text.slice(0, 2000), fixes: [], contentSuggestions: [] };
  }
}
