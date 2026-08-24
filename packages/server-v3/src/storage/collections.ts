import type { Database } from "bun:sqlite"
import type { createChangeStore } from "./changes"
import { fitsCollectionRow } from "../stream/pages"

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
  const exists = database.query<{ present: number }, [string, string, string]>(`
    SELECT 1 AS present FROM collection_row
    WHERE collection = ? AND scope_key = ? AND row_key = ?
  `)
  const list = database.query<CollectionRow, [string, string]>(`
    SELECT row_key, row, row_revision FROM collection_row
    WHERE collection = ? AND scope_key = ?
    ORDER BY row_key
  `)

  return {
    write(input: {
      collection: string
      scopeKey: string
      rowKey: string
      row: unknown
      revision: string
      txid?: string
    }) {
      assertRowsFit(input.collection, input.scopeKey, [{ key: input.rowKey, row: input.row, revision: input.revision }])
      return changes.batch(() =>
        database.transaction(() => {
          const stored = exists.get(input.collection, input.scopeKey, input.rowKey)
          upsert.run(input.collection, input.scopeKey, input.rowKey, encodeRow(input.row), input.revision)
          return changes.append({
            collection: input.collection,
            scopeKey: input.scopeKey,
            rowKey: input.rowKey,
            op: stored ? "update" : "insert",
            row: input.row,
            rowRevision: input.revision,
            txid: input.txid,
          })
        })(),
      )
    },
    delete(collection: string, scopeKey: string, rowKey: string, txid?: string) {
      return changes.batch(() =>
        database.transaction(() => {
          remove.run(collection, scopeKey, rowKey)
          return changes.append({ collection, scopeKey, rowKey, op: "delete", row: null, txid })
        })(),
      )
    },
    replace(
      collection: string,
      scopeKey: string,
      rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>,
      txid?: string,
    ) {
      assertRowsFit(collection, scopeKey, rows)
      return changes.batch(() =>
        database.transaction(() => {
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
        })(),
      )
    },
    hydrate(
      collection: string,
      scopeKey: string,
      rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>,
    ) {
      assertRowsFit(collection, scopeKey, rows)
      return database.transaction(() => {
        const current = list.all(collection, scopeKey)
        const incoming = new Set(rows.map((row) => row.key))
        rows.forEach((row) => upsert.run(collection, scopeKey, row.key, encodeRow(row.row), row.revision))
        current
          .filter((row) => !incoming.has(row.row_key))
          .forEach((row) => remove.run(collection, scopeKey, row.row_key))
        return (
          current.length !== rows.length ||
          rows.some((row) => {
            const stored = current.find((entry) => entry.row_key === row.key)
            return stored?.row !== encodeRow(row.row) || stored.row_revision !== row.revision
          })
        )
      })()
    },
    snapshot(collection: string, scopeKey: string) {
      return database.transaction(() => ({
        rows: list.all(collection, scopeKey).map((row) => ({
          key: row.row_key,
          row: JSON.parse(row.row),
          revision: row.row_revision,
        })),
        throughSeq: changes.current(),
      }))()
    },
  }
}

function encodeRow(row: unknown) {
  return JSON.stringify(row)
}

function assertRowsFit(
  collection: string,
  scopeKey: string,
  rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>,
) {
  if (rows.some((row) => !fitsCollectionRow(collection, scopeKey, row)))
    throw new Error("Collection row exceeds stream frame limit")
}
