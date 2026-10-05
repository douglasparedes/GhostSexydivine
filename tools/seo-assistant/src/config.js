import path from 'node:path';
import { fileURLToPath } from 'node:url';

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  return value === '' ? fallback : value;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: required('DATA_DIR', path.join(here, '..', 'data')),
  dbPath: process.env.SQLITE_PATH ?? undefined,
  ghostUrl: required('GHOST_URL'),
  ghostKey: required('GHOST_ADMIN_API_KEY'),
  ghostVersion: required('GHOST_API_VERSION', 'v6.0'),
  geminiKey: required('GEMINI_API_KEY'),
  geminiModel: required('GEMINI_MODEL', 'gemini-3-flash-preview'),
  adminEmail: required('SEO_ADMIN_EMAIL'),
  adminPassword: required('SEO_ADMIN_PASSWORD'),
  auditCron: required('AUDIT_CRON', '0 3 * * 0'),
  draftWatch: (required('DRAFT_WATCH', 'true') ?? 'true').toLowerCase() !== 'false',
  draftAiMinScore: Number(required('DRAFT_AI_MIN_SCORE', 70)),
  sessionDays: 7,
};
