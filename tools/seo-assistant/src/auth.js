import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import db, { normalizeInsert } from './db.js';
import { config } from './config.js';

const SESSION_COOKIE = 'seo_assistant_session';

export function ensureBootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    return { created: false };
  }
  if (!config.adminEmail || !config.adminPassword) {
    return { created: false, missingEnv: true };
  }
  if (config.adminPassword.length < 12) {
    throw new Error('SEO_ADMIN_PASSWORD must be at least 12 characters');
  }
  const hash = bcrypt.hashSync(config.adminPassword, 12);
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(
    config.adminEmail.toLowerCase(),
    hash,
    'admin',
  );
  return { created: true };
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createUser(email, password, role = 'member') {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  if (!['admin', 'member'].includes(role)) {
    throw new Error('Role must be admin or member');
  }
  const hash = bcrypt.hashSync(password, 12);
  try {
    const result = db
      .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
      .run(String(email).toLowerCase(), hash, role);
    return findUserById(normalizeInsert(result));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new Error('A user with that email already exists');
    }
    throw error;
  }
}

export function listUsers() {
  return db.prepare('SELECT id, email, role, created_at FROM users ORDER BY id ASC').all();
}

export function deleteUser(id) {
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (remaining <= 1) {
    throw new Error('Cannot delete the last user');
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expires,
  );
  return { token, expires };
}

export function getSessionUser(token) {
  if (!token) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token);
  return row ?? null;
}

export function destroySession(token) {
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

export function publicUser(user) {
  if (!user) {
    return null;
  }
  return { id: user.id, email: user.email, role: user.role };
}

export function requireAuth(req, res, next) {
  const user = getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  req.user = user;
  return next();
}

export function requireAdmin(req, res, next) {
  const user = getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  req.user = user;
  return next();
}

export { SESSION_COOKIE };
