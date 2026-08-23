import type { Database } from "bun:sqlite"

export function migrate(database: Database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS collection_feed (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      feed_id TEXT NOT NULL,
      retained_floor INTEGER NOT NULL,
      runtime_id TEXT NOT NULL
    )
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS collection_change (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      row_key TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete', 'reset')),
      row TEXT,
      row_revision TEXT,
      txid TEXT,
      runtime_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  database.run(`
    CREATE INDEX IF NOT EXISTS collection_change_scope_seq_idx
    ON collection_change (collection, scope_key, seq)
  `)
  database.run(`
    CREATE INDEX IF NOT EXISTS collection_change_created_at_idx
    ON collection_change (created_at)
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS idempotency_record (
      principal TEXT NOT NULL,
      operation TEXT NOT NULL,
      key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      response TEXT NOT NULL,
      txid TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (principal, operation, key)
    )
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS collection_row (
      collection TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      row_key TEXT NOT NULL,
      row TEXT NOT NULL,
      row_revision TEXT NOT NULL,
      PRIMARY KEY (collection, scope_key, row_key)
    )
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS full_content (
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (id, session_id, revision)
    )
  `)
}
