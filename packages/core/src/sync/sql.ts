import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

export const CollectionFeedTable = sqliteTable("collection_feed", {
  id: integer().primaryKey(),
  feed_id: text().notNull(),
  retained_floor: integer().notNull(),
  runtime_id: text().notNull(),
}, (table) => [check("collection_feed_singleton", sql`${table.id} = 1`)])

export const CollectionChangeTable = sqliteTable("collection_change", {
  seq: integer().primaryKey({ autoIncrement: true }),
  collection: text().notNull(),
  scope_key: text().notNull(),
  row_key: text().notNull(),
  op: text().notNull(),
  row: text(),
  row_revision: text(),
  txid: text(),
  runtime_id: text().notNull(),
  created_at: integer().notNull(),
}, (table) => [
  check("collection_change_operation", sql`${table.op} IN ('insert', 'update', 'delete', 'reset')`),
  index("collection_change_scope_seq_idx").on(table.collection, table.scope_key, table.seq),
  index("collection_change_created_at_idx").on(table.created_at),
])

export const IdempotencyRecordTable = sqliteTable("idempotency_record", {
  principal: text().notNull(),
  operation: text().notNull(),
  key: text().notNull(),
  fingerprint: text().notNull(),
  response: text().notNull(),
  txid: text().notNull(),
  created_at: integer().notNull(),
}, (table) => [primaryKey({ columns: [table.principal, table.operation, table.key] })])

export const CollectionRowTable = sqliteTable("collection_row", {
  collection: text().notNull(),
  scope_key: text().notNull(),
  row_key: text().notNull(),
  row: text().notNull(),
  row_revision: text().notNull(),
}, (table) => [primaryKey({ columns: [table.collection, table.scope_key, table.row_key] })])

export const FullContentTable = sqliteTable("full_content", {
  id: text().notNull(),
  session_id: text().notNull(),
  revision: text().notNull(),
  content: text().notNull(),
  created_at: integer().notNull(),
}, (table) => [primaryKey({ columns: [table.id, table.session_id, table.revision] })])
