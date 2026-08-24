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
      content BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (id, session_id, revision)
    )
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS full_content_reference (
      source_type TEXT NOT NULL CHECK (source_type IN ('row', 'change')),
      source_key TEXT NOT NULL,
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      PRIMARY KEY (source_type, source_key, id, session_id, revision)
    )
  `)
  database.run(`
    CREATE INDEX IF NOT EXISTS full_content_reference_content_idx
    ON full_content_reference (id, session_id, revision)
  `)
  database.run(`
    CREATE TRIGGER IF NOT EXISTS collection_row_content_reference_insert
    AFTER INSERT ON collection_row
    WHEN NEW.collection IN ('messages', 'parts', 'sessionInputs')
    BEGIN
      INSERT OR IGNORE INTO full_content_reference (source_type, source_key, id, session_id, revision)
      SELECT 'row', NEW.collection || char(0) || NEW.scope_key || char(0) || NEW.row_key,
        json_extract(content.value, '$.id'), NEW.scope_key, json_extract(content.value, '$.revision')
      FROM json_tree(CASE WHEN json_valid(NEW.row) THEN NEW.row ELSE 'null' END) AS content
      WHERE content.key = 'content' AND content.type = 'object'
        AND json_type(content.value, '$.id') = 'text'
        AND json_type(content.value, '$.revision') = 'text';
    END
  `)
  database.run(`
    CREATE TRIGGER IF NOT EXISTS collection_row_content_reference_update
    AFTER UPDATE ON collection_row
    BEGIN
      DELETE FROM full_content_reference
      WHERE source_type = 'row'
        AND source_key = OLD.collection || char(0) || OLD.scope_key || char(0) || OLD.row_key;
      INSERT OR IGNORE INTO full_content_reference (source_type, source_key, id, session_id, revision)
      SELECT 'row', NEW.collection || char(0) || NEW.scope_key || char(0) || NEW.row_key,
        json_extract(content.value, '$.id'), NEW.scope_key, json_extract(content.value, '$.revision')
      FROM json_tree(CASE WHEN json_valid(NEW.row) THEN NEW.row ELSE 'null' END) AS content
      WHERE NEW.collection IN ('messages', 'parts', 'sessionInputs')
        AND content.key = 'content' AND content.type = 'object'
        AND json_type(content.value, '$.id') = 'text'
        AND json_type(content.value, '$.revision') = 'text';
    END
  `)
  database.run(`
    CREATE TRIGGER IF NOT EXISTS collection_row_content_reference_delete
    AFTER DELETE ON collection_row
    BEGIN
      DELETE FROM full_content_reference
      WHERE source_type = 'row'
        AND source_key = OLD.collection || char(0) || OLD.scope_key || char(0) || OLD.row_key;
    END
  `)
  database.run(`
    CREATE TRIGGER IF NOT EXISTS collection_change_content_reference_insert
    AFTER INSERT ON collection_change
    WHEN NEW.collection IN ('messages', 'parts', 'sessionInputs') AND NEW.row IS NOT NULL
    BEGIN
      INSERT OR IGNORE INTO full_content_reference (source_type, source_key, id, session_id, revision)
      SELECT 'change', CAST(NEW.seq AS TEXT), json_extract(content.value, '$.id'),
        NEW.scope_key, json_extract(content.value, '$.revision')
      FROM json_tree(CASE WHEN json_valid(NEW.row) THEN NEW.row ELSE 'null' END) AS content
      WHERE content.key = 'content' AND content.type = 'object'
        AND json_type(content.value, '$.id') = 'text'
        AND json_type(content.value, '$.revision') = 'text';
    END
  `)
  database.run(`
    CREATE TRIGGER IF NOT EXISTS collection_change_content_reference_delete
    AFTER DELETE ON collection_change
    BEGIN
      DELETE FROM full_content_reference
      WHERE source_type = 'change' AND source_key = CAST(OLD.seq AS TEXT);
    END
  `)
  database.run(`CREATE TABLE IF NOT EXISTS server_v3_migration (id TEXT PRIMARY KEY)`)
  if (
    database
      .query<{ present: number }, []>(
        "SELECT 1 AS present FROM server_v3_migration WHERE id = 'full-content-references-v1'",
      )
      .get()
  )
    return
  database.transaction(() => {
    database.run("DELETE FROM full_content_reference")
    database.run(`
      INSERT OR IGNORE INTO full_content_reference (source_type, source_key, id, session_id, revision)
      SELECT 'row', collection_row.collection || char(0) || collection_row.scope_key || char(0) || collection_row.row_key,
        json_extract(content.value, '$.id'), collection_row.scope_key, json_extract(content.value, '$.revision')
      FROM collection_row,
        json_tree(CASE WHEN json_valid(collection_row.row) THEN collection_row.row ELSE 'null' END) AS content
      WHERE collection_row.collection IN ('messages', 'parts', 'sessionInputs')
        AND content.key = 'content' AND content.type = 'object'
        AND json_type(content.value, '$.id') = 'text'
        AND json_type(content.value, '$.revision') = 'text'
    `)
    database.run(`
      INSERT OR IGNORE INTO full_content_reference (source_type, source_key, id, session_id, revision)
      SELECT 'change', CAST(collection_change.seq AS TEXT), json_extract(content.value, '$.id'),
        collection_change.scope_key, json_extract(content.value, '$.revision')
      FROM collection_change,
        json_tree(CASE WHEN json_valid(collection_change.row) THEN collection_change.row ELSE 'null' END) AS content
      WHERE collection_change.collection IN ('messages', 'parts', 'sessionInputs')
        AND collection_change.row IS NOT NULL
        AND content.key = 'content' AND content.type = 'object'
        AND json_type(content.value, '$.id') = 'text'
        AND json_type(content.value, '$.revision') = 'text'
    `)
    database.run("INSERT INTO server_v3_migration (id) VALUES ('full-content-references-v1')")
  })()
}
