# Ghost SEO Assistant

Chat assistant that audits Ghost posts and pages for SEO and applies approved
fixes through the Admin API. Lives in `tools/` so it stays outside the pnpm
workspace and deploys independently (for example as a Coolify service next to
Ghost). Follows the standalone-tool pattern from `.github/scripts/i18n-review`:
own npm lockfile, own eslint config, `node --test` for tests.

## What it does

- Chat UI: `audit all`, `audit posts`, `audit pages`, `audit slug/your-slug`, `history`.
- Deterministic rule engine scores every item 0-100 (titles, meta, slugs,
  excerpts, images and alt text, tags, headings, word count, links, canonical,
  code injection, social images, freshness).
- Gemini Flash drafts fixed copy (meta titles, descriptions, tags, excerpts)
  as structured diffs.
- Nothing writes to Ghost without an explicit per-fix approval in the chat.
  Slugs and article bodies are never auto-edited. Every applied fix is logged
  with before/after values.
- Nightly scheduled audits with history and score tracking (SQLite).
- Per-user login: first run creates an admin from env; admins can add members.

## Setup

Requirements: Node 22 or newer, a Ghost Admin API key, a Gemini API key.

1. In Ghost Admin, create a Custom Integration under Settings and copy the
   Admin API key.
2. Create a Gemini API key in Google AI Studio.
3. Configure the environment (see table below). At minimum:

   GHOST_URL, GHOST_ADMIN_API_KEY, GEMINI_API_KEY,
   SEO_ADMIN_EMAIL, SEO_ADMIN_PASSWORD (12+ characters, first run only).

4. Install and run:

   npm ci
   npm test
   npm start

Open the printed port (default 3000) and sign in.

## Environment

| Variable            | Default                | Purpose                                            |
| ------------------- | ---------------------- | -------------------------------------------------- |
| PORT                | 3000                   | HTTP port                                          |
| DATA_DIR            | ./data                 | SQLite directory (mount a volume in production)    |
| SQLITE_PATH         | DATA_DIR/db file       | Full database path override                        |
| GHOST_URL           | —                      | Publication URL, e.g. your Ghost domain            |
| GHOST_ADMIN_API_KEY | —                      | Custom Integration Admin API key                   |
| GHOST_API_VERSION   | v6.0                   | Admin API version header                           |
| GEMINI_API_KEY      | —                      | Google AI key (chat analysis disabled without it)  |
| GEMINI_MODEL        | gemini-3-flash-preview | Model for summaries and fix drafts                 |
| SEO_ADMIN_EMAIL     | —                      | Bootstrap admin (first run with empty users table) |
| SEO_ADMIN_PASSWORD  | —                      | Bootstrap admin password, 12+ characters           |
| AUDIT_CRON          | `0 3 * * 0`            | Scheduled full audit; empty disables it            |

Without GEMINI_API_KEY the rule audits, scoring, history, and approvals all
work; only AI summaries and drafted copy are unavailable.

## Deploying on Coolify

Build this folder as a Dockerfile service (context at the `tools/seo-assistant`
directory or repo root with a matching Dockerfile path). Expose port 3000,
attach a persistent volume at `/data`, and set the environment above with
sensitive values marked secret. Single replica only: audit jobs live in
process memory.

## Scripts

- `npm start` — run the server.
- `npm test` — rule-engine and approval-guard unit tests.
- `npm run lint` — eslint with the tool-local config.
