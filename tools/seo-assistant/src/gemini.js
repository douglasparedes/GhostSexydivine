import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

let client = null;

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

export async function askQuestion(question, context) {
  const ai = getClient();
  const prompt = [
    'You are an SEO assistant for a Ghost publication. Answer the user question concisely.',
    'You can reference this workspace context (recent audit runs):',
    context,
    '',
    `Question: ${question}`,
  ].join('\n');
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    config: { maxOutputTokens: 1024 },
  });
  return response.text ?? '';
}

export async function enrichAnalysis({ resource, resourceType, analysis }) {
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

  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: FIX_SCHEMA,
      maxOutputTokens: 2048,
    },
  });
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
