import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// node:sqlite (built-in, no native dependency) keeps the Docker image a
// single slim stage on every architecture. The API surface used here
// (exec/prepare/run/get/all) is shared with better-sqlite3 conventions.

function resolveDbPath() {
  if (config.dbPath) {
    return config.dbPath;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  return path.join(config.dataDir, 'seo-assistant.db');
}

const db = new DatabaseSync(resolveDbPath());
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  score INTEGER NOT NULL,
  findings TEXT NOT NULL,
  ai_summary TEXT,
  fixes TEXT
);

CREATE TABLE IF NOT EXISTS applied_fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER REFERENCES audits(id) ON DELETE SET NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  field TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  applied_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function normalizeInsert(result) {
  return Number(result.lastInsertRowid);
}

export { normalizeInsert };
export default db;
