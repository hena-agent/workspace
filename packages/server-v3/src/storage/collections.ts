import type { Database } from "bun:sqlite"
import type { createChangeStore } from "./changes"

type ChangeStore = ReturnType<typeof createChangeStore>

type CollectionRow = {
  row_key: string
  row: string
  row_revision: string
}

export function createCollectionStore(database: Database, changes: ChangeStore) {
  const upsert = database.query(`
    INSERT INTO collection_row (collection, scope_key, row_key, row, row_revision)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (collection, scope_key, row_key)
    DO UPDATE SET row = excluded.row, row_revision = excluded.row_revision
  `)
  const remove = database.query("DELETE FROM collection_row WHERE collection = ? AND scope_key = ? AND row_key = ?")
  const list = database.query<CollectionRow, [string, string]>(`
    SELECT row_key, row, row_revision FROM collection_row
    WHERE collection = ? AND scope_key = ?
    ORDER BY row_key
  `)
  const watermark = database.query<{ seq: number }, []>("SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change")

  return {
    write(input: {
      collection: string
      scopeKey: string
      rowKey: string
      row: unknown
      revision: string
      txid?: string
    }) {
      return changes.batch(() => database.transaction(() => {
        upsert.run(input.collection, input.scopeKey, input.rowKey, encodeRow(input.row), input.revision)
        return changes.append({
          collection: input.collection,
          scopeKey: input.scopeKey,
          rowKey: input.rowKey,
          op: "update",
          row: input.row,
          rowRevision: input.revision,
          txid: input.txid,
        })
      })())
    },
    delete(collection: string, scopeKey: string, rowKey: string, txid?: string) {
      return changes.batch(() => database.transaction(() => {
        remove.run(collection, scopeKey, rowKey)
        return changes.append({ collection, scopeKey, rowKey, op: "delete", row: null, txid })
      })())
    },
    replace(
      collection: string,
      scopeKey: string,
      rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>,
      txid?: string,
    ) {
      return changes.batch(() => database.transaction(() => {
        const incoming = new Set(rows.map((row) => row.key))
        const current = list.all(collection, scopeKey)
        const output = rows.map((row) => {
          upsert.run(collection, scopeKey, row.key, encodeRow(row.row), row.revision)
          return changes.append({
            collection,
            scopeKey,
            rowKey: row.key,
            op: current.some((entry) => entry.row_key === row.key) ? "update" : "insert",
            row: row.row,
            rowRevision: row.revision,
            txid,
          })
        })
        for (const stale of current.filter((row) => !incoming.has(row.row_key))) {
          remove.run(collection, scopeKey, stale.row_key)
          output.push(changes.append({ collection, scopeKey, rowKey: stale.row_key, op: "delete", row: null, txid }))
        }
        return output
      })())
    },
    hydrate(collection: string, scopeKey: string, rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>) {
      return database.transaction(() => {
        const incoming = new Set(rows.map((row) => row.key))
        rows.forEach((row) => upsert.run(collection, scopeKey, row.key, encodeRow(row.row), row.revision))
        list.all(collection, scopeKey)
          .filter((row) => !incoming.has(row.row_key))
          .forEach((row) => remove.run(collection, scopeKey, row.row_key))
      })()
    },
    snapshot(collection: string, scopeKey: string) {
      return database.transaction(() => ({
        rows: list.all(collection, scopeKey).map((row) => ({
          key: row.row_key,
          row: JSON.parse(row.row),
          revision: row.row_revision,
        })),
        throughSeq: watermark.get()!.seq,
      }))()
    },
  }
}

function encodeRow(row: unknown) {
  const encoded = JSON.stringify(row)
  if (new TextEncoder().encode(encoded).byteLength > 1024 * 1024) throw new Error("Collection row exceeds 1 MiB")
  return encoded
}
