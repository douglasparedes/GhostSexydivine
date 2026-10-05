import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as auth from './auth.js';
import * as ghost from './ghost.js';
import * as gemini from './gemini.js';
import * as audit from './audit.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function parseCookies(req) {
  const header = req.headers.cookie ?? '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  req.cookies = cookies;
}

app.use(parseCookies);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ghost: ghost.isConfigured(), gemini: gemini.isConfigured() });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = auth.findUserByEmail(email);
  if (!user || !auth.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const session = auth.createSession(user.id);
  res.cookie(auth.SESSION_COOKIE, session.token, auth.sessionCookieOptions());
  return res.json({ user: auth.publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req.cookies?.[auth.SESSION_COOKIE]);
  res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
  return res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = auth.getSessionUser(req.cookies?.[auth.SESSION_COOKIE]);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  return res.json({ user: auth.publicUser(user) });
});

app.get('/api/users', auth.requireAdmin, (req, res) => {
  return res.json({ users: auth.listUsers() });
});

app.post('/api/users', auth.requireAdmin, (req, res) => {
  try {
    const { email, password, role } = req.body ?? {};
    const user = auth.createUser(email, password, role ?? 'member');
    return res.status(201).json({ user: auth.publicUser(user) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/api/users/:id', auth.requireAdmin, (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    auth.deleteUser(Number(req.params.id));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/audits', auth.requireAuth, (req, res) => {
  if (!ghost.isConfigured()) {
    return res
      .status(503)
      .json({ error: 'Ghost is not configured. Set GHOST_URL and GHOST_ADMIN_API_KEY.' });
  }
  const { kind, resourceType, resourceId, withAi } = req.body ?? {};
  if (!['posts', 'pages', 'all', 'single'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be posts, pages, all, or single' });
  }
  if (kind === 'single' && (!resourceType || !resourceId)) {
    return res.status(400).json({ error: 'single audits need resourceType and resourceId' });
  }
  const target = kind === 'single' ? `${resourceType}:${resourceId}` : kind;
  const job = audit.createJob(kind, target);
  audit
    .runAudit({ kind, target, resourceType, resourceId, withAi: withAi !== false })
    .then((finished) => {
      Object.assign(job, finished);
    })
    .catch((error) => {
      Object.assign(job, { status: 'failed', error: error.message });
    });
  return res.status(202).json({ jobId: job.id });
});

app.get('/api/jobs/:id', auth.requireAuth, (req, res) => {
  const job = audit.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json({ job });
});

app.get('/api/audits', auth.requireAuth, (req, res) => {
  return res.json({ audits: audit.listAudits() });
});

app.get('/api/audits/:id', auth.requireAuth, (req, res) => {
  const result = audit.getAudit(Number(req.params.id));
  if (!result) {
    return res.status(404).json({ error: 'Audit not found' });
  }
  return res.json({ audit: result });
});

app.post('/api/fixes', auth.requireAuth, (req, res) => {
  const { auditId, resourceType, resourceId, field, value } = req.body ?? {};
  if (!resourceType || !resourceId || !field || value === undefined) {
    return res
      .status(400)
      .json({ error: 'resourceType, resourceId, field, and value are required' });
  }
  audit
    .applyApprovedFix({
      auditId: auditId ?? null,
      resourceType,
      resourceId,
      field,
      value,
      appliedBy: req.user.id,
    })
    .then((result) => res.json({ ok: true, result }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

app.get('/api/fixes', auth.requireAuth, (req, res) => {
  return res.json({ fixes: audit.listFixes() });
});

function helpText() {
  return [
    'I can audit your Ghost content for SEO. Try:',
    '- "audit all" — every post and page',
    '- "audit posts" or "audit pages"',
    '- "audit slug/my-post-slug" — one item by slug',
    '- "history" — past audit runs',
    'Each report scores items 0-100, lists rule findings, and proposes fixes you approve one by one. I only ever write fields you approve, and slugs and article bodies are never auto-edited.',
  ].join('\n');
}

async function findBySlug(slug) {
  const [posts, pages] = await Promise.all([ghost.listPosts(), ghost.listPages()]);
  const post = posts.find((item) => item.slug === slug);
  if (post) {
    return { resourceType: 'posts', resourceId: post.id, title: post.title };
  }
  const page = pages.find((item) => item.slug === slug);
  if (page) {
    return { resourceType: 'pages', resourceId: page.id, title: page.title };
  }
  return null;
}

app.post('/api/chat', auth.requireAuth, async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  const lower = message.toLowerCase();

  if (/\bhelp\b/.test(lower) || lower === 'hi' || lower === 'hello') {
    return res.json({ reply: helpText(), actions: [] });
  }
  if (/\bhistory\b/.test(lower)) {
    const audits = audit.listAudits(10);
    if (audits.length === 0) {
      return res.json({
        reply: 'No audits yet. Say "audit all" to run the first one.',
        actions: [],
      });
    }
    const lines = audits.map(
      (item) => `#${item.id} ${item.kind} (${item.target}) — ${item.status}: ${item.summary ?? ''}`,
    );
    return res.json({ reply: `Recent audits:\n${lines.join('\n')}`, audits, actions: [] });
  }
  if (!ghost.isConfigured()) {
    return res.json({
      reply:
        'Ghost is not connected yet. Set GHOST_URL and GHOST_ADMIN_API_KEY on the server and restart me.',
      actions: [],
    });
  }

  const allMatch = lower.match(/\baudit\s+all\b/);
  const postsMatch = lower.match(/\baudit\s+posts\b/);
  const pagesMatch = lower.match(/\baudit\s+pages\b/);
  const slugMatch = lower.match(/\baudit\s+(?:slug\/)?([a-z0-9][a-z0-9-]*)\b/);
  try {
    if (allMatch) {
      const job = audit.createJob('all', 'chat');
      audit
        .runAudit({ kind: 'all', target: 'chat' })
        .then((finished) => Object.assign(job, finished));
      return res.json({
        reply:
          'Full audit started (posts and pages). I will report back when it finishes — poll the job for progress.',
        jobId: job.id,
        actions: [],
      });
    }
    if (postsMatch || pagesMatch) {
      const kind = postsMatch ? 'posts' : 'pages';
      const job = audit.createJob(kind, 'chat');
      audit.runAudit({ kind, target: 'chat' }).then((finished) => Object.assign(job, finished));
      return res.json({
        reply: `Audit of ${kind} started. Poll the job for progress.`,
        jobId: job.id,
        actions: [],
      });
    }
    if (slugMatch) {
      const found = await findBySlug(slugMatch[1]);
      if (!found) {
        return res.json({
          reply: `No post or page found with slug "${slugMatch[1]}".`,
          actions: [],
        });
      }
      const job = audit.createJob('single', found.title);
      audit
        .runAudit({
          kind: 'single',
          target: found.title,
          resourceType: found.resourceType,
          resourceId: found.resourceId,
        })
        .then((finished) => Object.assign(job, finished));
      return res.json({
        reply: `Auditing "${found.title}" now. Poll the job for the report.`,
        jobId: job.id,
        actions: [],
      });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!gemini.isConfigured()) {
    return res.json({
      reply: `${helpText()}\n\nNote: free-form answers need GEMINI_API_KEY; audit commands above work without it.`,
      actions: [],
    });
  }
  try {
    const recent = audit.listAudits(3);
    const context =
      recent.map((item) => `#${item.id} ${item.kind}: ${item.summary ?? item.status}`).join('\n') ||
      'No audits yet.';
    const reply = await gemini.askQuestion(message, context);
    return res.json({ reply, actions: [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export function start(port = config.port) {
  try {
    const result = auth.ensureBootstrapAdmin();
    if (result.created) {
      console.log('Created initial admin user from SEO_ADMIN_EMAIL');
    } else if (result.missingEnv) {
      console.log('No users yet: set SEO_ADMIN_EMAIL and SEO_ADMIN_PASSWORD, then restart');
    }
  } catch (error) {
    console.log(`Admin bootstrap failed: ${error.message}`);
  }
  startScheduler();
  return app.listen(port, () => {
    console.log(`SEO assistant listening on port ${port}`);
  });
}

if (
  process.argv[1] === new URL(import.meta.url).pathname ||
  process.argv[1]?.endsWith('server.js')
) {
  start();
}

export default app;
