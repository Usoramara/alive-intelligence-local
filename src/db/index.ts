import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { LOCAL_USER_ID } from '@/lib/local-user';
import path from 'path';
import fs from 'fs';

function createDb() {
  const dbPath = process.env.DATABASE_URL ?? './data/wybe.db';

  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Auto-initialize: create tables if they don't exist
  initializeDatabase(sqlite);

  // Ensure local user exists
  ensureLocalUser(sqlite);

  return db;
}

function initializeDatabase(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT 'local@wybe.local',
      display_name TEXT,
      tier TEXT NOT NULL DEFAULT 'local',
      api_key_encrypted TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT DEFAULT 'New conversation',
      channel TEXT DEFAULT 'web',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      emotion_shift TEXT,
      metadata TEXT,
      enriched INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id);

    CREATE TABLE IF NOT EXISTS cognitive_states (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      valence REAL NOT NULL DEFAULT 0.6,
      arousal REAL NOT NULL DEFAULT 0.3,
      confidence REAL NOT NULL DEFAULT 0.5,
      energy REAL NOT NULL DEFAULT 0.7,
      social REAL NOT NULL DEFAULT 0.4,
      curiosity REAL NOT NULL DEFAULT 0.6,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'episodic',
      content TEXT NOT NULL,
      significance REAL NOT NULL DEFAULT 0.5,
      tags TEXT,
      embedding TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS memories_user_idx ON memories(user_id);

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      cron_expr TEXT,
      next_run_at TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC',
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS scheduled_jobs_user_idx ON scheduled_jobs(user_id);
    CREATE INDEX IF NOT EXISTS scheduled_jobs_status_next_run_idx ON scheduled_jobs(status, next_run_at);

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cents REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS usage_user_idx ON usage_records(user_id);

    CREATE TABLE IF NOT EXISTS agent_files (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_files_agent_file_idx ON agent_files(agent_id, file_name);

    CREATE TABLE IF NOT EXISTS channel_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      channel_user_id TEXT NOT NULL,
      messages TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS channel_conversations_user_channel_idx ON channel_conversations(user_id, channel_type, channel_user_id);
  `);
}

function ensureLocalUser(sqlite: InstanceType<typeof Database>) {
  const exists = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(LOCAL_USER_ID);
  if (!exists) {
    sqlite.prepare(
      'INSERT INTO users (id, email, display_name, tier) VALUES (?, ?, ?, ?)',
    ).run(LOCAL_USER_ID, 'local@wybe.local', 'Local User', 'local');
  }
}

// Lazy singleton — only created when first accessed
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

export type Database = ReturnType<typeof createDb>;
export { schema };
