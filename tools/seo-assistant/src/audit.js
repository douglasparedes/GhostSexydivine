import crypto from 'node:crypto';
import db, { normalizeInsert } from './db.js';
import { analyzeResource } from './rules.js';
import * as ghost from './ghost.js';
import * as gemini from './gemini.js';

const jobs = new Map();

function siteUrl() {
  return process.env.GHOST_URL ?? null;
}

export function createJob(kind, target) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, kind, target, status: 'running', createdAt: new Date().toISOString() };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

function storeAudit(kind, target) {
  const row = db
    .prepare('INSERT INTO audits (kind, target, status) VALUES (?, ?, ?)')
    .run(kind, target, 'running');
  return normalizeInsert(row);
}

function storeItem(auditId, resourceType, resource, analysis, enrichment) {
  db.prepare(
    `INSERT INTO audit_items
     (audit_id, resource_type, resource_id, title, url, score, findings, ai_summary, fixes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    auditId,
    resourceType,
    resource.id,
    resource.title ?? '(untitled)',
    resource.url ?? null,
    analysis.score,
    JSON.stringify(analysis.findings),
    enrichment?.summary ?? null,
    JSON.stringify(enrichment?.fixes ?? []),
  );
  return {
    resourceType,
    resourceId: resource.id,
    title: resource.title ?? '(untitled)',
    url: resource.url ?? null,
    score: analysis.score,
    findings: analysis.findings,
    aiSummary: enrichment?.summary ?? null,
    fixes: enrichment?.fixes ?? [],
    contentSuggestions: enrichment?.contentSuggestions ?? [],
  };
}

export async function runAudit({ kind, target, resourceType, resourceId, withAi = true }) {
  const job = createJob(kind, target);
  const auditId = storeAudit(kind, target);
  job.auditId = auditId;
  const items = [];
  try {
    let resources = [];
    if (kind === 'single') {
      const resource = await ghost.readResource(resourceType, resourceId);
      resources = [{ resourceType, resource }];
    } else if (kind === 'posts' || kind === 'all') {
      const posts = await ghost.listPosts();
      resources.push(...posts.map((resource) => ({ resourceType: 'posts', resource })));
    }
    if (kind === 'pages' || kind === 'all') {
      const pages = await ghost.listPages();
      resources.push(...pages.map((resource) => ({ resourceType: 'pages', resource })));
    }
    const useAi = withAi && gemini.isConfigured();
    for (const { resourceType: type, resource } of resources) {
      const analysis = analyzeResource(resource, siteUrl());
      let enrichment = null;
      if (useAi) {
        try {
          enrichment = await gemini.enrichAnalysis({ resource, resourceType: type, analysis });
        } catch (error) {
          enrichment = {
            summary: `AI analysis failed: ${error.message}`,
            fixes: [],
            contentSuggestions: [],
          };
        }
      }
      items.push(storeItem(auditId, type, resource, analysis, enrichment));
    }
    const average =
      items.length === 0
        ? 0
        : Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length);
    const summary = `${items.length} item(s) audited, average score ${average}`;
    db.prepare(
      "UPDATE audits SET status = 'done', summary = ?, finished_at = datetime('now') WHERE id = ?",
    ).run(summary, auditId);
    Object.assign(job, { status: 'done', auditId, itemCount: items.length, average, items });
  } catch (error) {
    db.prepare(
      "UPDATE audits SET status = 'failed', summary = ?, finished_at = datetime('now') WHERE id = ?",
    ).run(String(error.message).slice(0, 500), auditId);
    Object.assign(job, { status: 'failed', error: error.message });
  }
  return job;
}

export async function applyApprovedFix({
  auditId,
  resourceType,
  resourceId,
  field,
  value,
  appliedBy,
}) {
  const result = await ghost.applyFix({ resourceType, id: resourceId, field, value, appliedBy });
  db.prepare(
    `INSERT INTO applied_fixes (audit_id, resource_type, resource_id, field, before_value, after_value, applied_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    auditId ?? null,
    resourceType,
    resourceId,
    field,
    JSON.stringify(result.before),
    JSON.stringify(result.after),
    appliedBy ?? null,
  );
  return result;
}

export function listAudits(limit = 20) {
  return db.prepare('SELECT * FROM audits ORDER BY id DESC LIMIT ?').all(limit);
}

export function getAudit(id) {
  const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(id);
  if (!audit) {
    return null;
  }
  const items = db
    .prepare('SELECT * FROM audit_items WHERE audit_id = ? ORDER BY score ASC')
    .all(id);
  return {
    ...audit,
    items: items.map((item) => ({
      ...item,
      findings: JSON.parse(item.findings),
      fixes: JSON.parse(item.fixes),
    })),
  };
}

export function listFixes(limit = 50) {
  return db.prepare('SELECT * FROM applied_fixes ORDER BY id DESC LIMIT ?').all(limit);
}
