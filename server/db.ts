import './config.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const dataDir = process.env.DATA_DIR || path.resolve('var');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(path.join(dataDir, 'media'), { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(path.join(dataDir, 'dark.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, totp TEXT, pending_totp TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (workspace TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY(workspace,user));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT REFERENCES users(id) ON DELETE CASCADE, workspace TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS objects_workspace_kind ON objects(workspace,kind);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, external_id TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, is_test INTEGER NOT NULL, created INTEGER NOT NULL, UNIQUE(workspace,provider,external_id));
CREATE INDEX IF NOT EXISTS events_workspace_created ON events(workspace,created DESC);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, type TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, due INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease INTEGER, error TEXT, claimed_by TEXT);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,due);
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, message TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS one_time (token TEXT PRIMARY KEY, user TEXT, workspace TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL);
INSERT OR IGNORE INTO migrations(version) VALUES(1);
`);
if (!(db.prepare('PRAGMA table_info(jobs)').all() as any[]).some(c=>c.name==='claimed_by')) db.exec('ALTER TABLE jobs ADD COLUMN claimed_by TEXT');
export type Item = Record<string, any> & { id: string };
export function list(workspace: string, kind: string): Item[] {
  return (db.prepare('SELECT * FROM objects WHERE workspace=? AND kind=? ORDER BY created').all(workspace, kind) as any[]).map(row => ({ ...JSON.parse(row.data), id: row.id }));
}
export function get(workspace: string, kind: string, id: string): Item | undefined {
  const row = db.prepare('SELECT * FROM objects WHERE workspace=? AND kind=? AND id=?').get(workspace, kind, id) as any;
  return row ? { ...JSON.parse(row.data), id: row.id } : undefined;
}
export function put(workspace: string, kind: string, data: Record<string, any>, id: string = randomUUID()): Item {
  const existing = get(workspace, kind, id);
  const merged = { ...existing, ...data, id };
  const now = Date.now();
  db.prepare(`INSERT INTO objects(id,workspace,kind,data,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated WHERE objects.workspace=excluded.workspace AND objects.kind=excluded.kind`).run(id, workspace, kind, JSON.stringify(merged), now, now);
  return merged;
}
export function remove(workspace: string, kind: string, id: string) { db.prepare('DELETE FROM objects WHERE workspace=? AND kind=? AND id=?').run(workspace, kind, id); }
export function settings(workspace: string) { return list(workspace, 'settings')[0] || put(workspace, 'settings', { goal: 150000, goalName: 'Meta da comunidade', character: 'darkbot', characterArtworkId: null, overlayColor: '#a251ff', overlayPosition: 'top-left', rankingVisible: false, countdownAt: null, blockedWords: ['spamproibido'], blockLinks: true, maxLength: 200, manualApproval: false, paused: false, emergency: false, scene: 'Principal', timezone: 'America/Fortaleza', retentionDays: 90, overlayToken: randomUUID() + randomUUID() }); }
export function log(workspace: string, message: string) { db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(), workspace, message, Date.now()); }
export function jobs(workspace: string) { return (db.prepare('SELECT * FROM jobs WHERE workspace=? ORDER BY created DESC LIMIT 200').all(workspace) as any[]).map(j => ({ ...j, data: JSON.parse(j.data) })); }
export function transaction<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } }
