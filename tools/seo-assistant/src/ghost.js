import GhostAdminAPI from '@tryghost/admin-api';
import { config } from './config.js';

// Fields that the approval flow is allowed to write. Slugs are excluded on
// purpose: changing a slug breaks existing URLs. Content bodies are never
// auto-edited; suggestions for them stay advisory.
export const WRITABLE_FIELDS = new Set([
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
]);

let client = null;

export function isConfigured() {
  return Boolean(config.ghostUrl && config.ghostKey);
}

function getClient() {
  if (!isConfigured()) {
    throw new Error('Ghost is not configured. Set GHOST_URL and GHOST_ADMIN_API_KEY.');
  }
  if (!client) {
    client = new GhostAdminAPI({
      url: config.ghostUrl,
      key: config.ghostKey,
      version: config.ghostVersion,
    });
  }
  return client;
}

const POST_FIELDS = [
  'id',
  'title',
  'slug',
  'excerpt',
  'custom_excerpt',
  'feature_image',
  'feature_image_alt',
  'feature_image_caption',
  'meta_title',
  'meta_description',
  'og_title',
  'og_description',
  'og_image',
  'twitter_title',
  'twitter_description',
  'twitter_image',
  'canonical_url',
  'codeinjection_head',
  'codeinjection_foot',
  'html',
  'status',
  'visibility',
  'published_at',
  'updated_at',
  'created_at',
  'url',
];

async function browseAll(resource, filter) {
  const api = getClient();
  const results = [];
  let page = 1;
  for (;;) {
    const response = await api[resource].browse({
      limit: 50,
      page,
      filter,
      fields: POST_FIELDS,
      include: 'tags,authors',
    });
    results.push(...(response ?? []));
    const pagination = response?.meta?.pagination;
    if (!pagination || !pagination.next) {
      break;
    }
    page = pagination.next;
  }
  return results;
}

export async function listPosts(status = 'all') {
  const filter = status === 'all' ? undefined : `status:${status}`;
  return browseAll('posts', filter);
}

export async function listPages(status = 'all') {
  const filter = status === 'all' ? undefined : `status:${status}`;
  return browseAll('pages', filter);
}

export async function readResource(resourceType, id) {
  const api = getClient();
  const resource = resourceType === 'pages' ? api.pages : api.posts;
  const response = await resource.read({ id }, { fields: POST_FIELDS, include: 'tags,authors' });
  return Array.isArray(response) ? response[0] : response;
}

export function validateFix(field) {
  if (!WRITABLE_FIELDS.has(field)) {
    throw new Error(`Field "${field}" is not writable through the approval flow`);
  }
}

async function resolveTagNames(api, names) {
  const existing = await api.tags.browse({ limit: 'all', fields: ['id', 'name', 'slug'] });
  const byName = new Map((existing ?? []).map((tag) => [tag.name.toLowerCase(), tag]));
  const resolved = [];
  for (const name of names) {
    const found = byName.get(String(name).toLowerCase());
    if (found) {
      resolved.push({ id: found.id });
    } else {
      const created = await api.tags.add({ name });
      const tag = Array.isArray(created) ? created[0] : created;
      resolved.push({ id: tag.id });
    }
  }
  return resolved;
}

export async function applyFix({ resourceType, id, field, value, appliedBy }) {
  validateFix(field);
  if (resourceType !== 'posts' && resourceType !== 'pages') {
    throw new Error(`Unknown resource type "${resourceType}"`);
  }
  const api = getClient();
  const resource = resourceType === 'pages' ? api.pages : api.posts;
  const current = await readResource(resourceType, id);
  if (!current) {
    throw new Error('Resource not found in Ghost');
  }
  const payload = { id, updated_at: current.updated_at };
  if (field === 'tags') {
    const names = Array.isArray(value) ? value : [value];
    payload.tags = await resolveTagNames(api, names);
  } else {
    payload[field] = value;
  }
  const before =
    field === 'tags' ? (current.tags ?? []).map((tag) => tag.name) : (current[field] ?? null);
  const response = await resource.edit(payload);
  const saved = Array.isArray(response) ? response[0] : response;
  const after =
    field === 'tags' ? (saved.tags ?? []).map((tag) => tag.name) : (saved[field] ?? null);
  return { before, after, appliedBy };
}
