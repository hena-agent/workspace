import type { Database } from "bun:sqlite"
import type { createCollectionStore } from "./collections"

type CollectionStore = ReturnType<typeof createCollectionStore>

type SettingRow = { row: string; row_revision: string }

export class RevisionConflict extends Error {
  readonly code = "revision_conflict"
  constructor(readonly authoritative: { value: unknown; revision: string } | undefined) {
    super("Setting revision does not match")
  }
}
export class SettingTooLarge extends Error {}

export function createSettingStore(database: Database, collections: CollectionStore) {
  const get = database.query<SettingRow, [string, string]>(`
    SELECT row, row_revision FROM collection_row
    WHERE collection = 'settings' AND scope_key = ? AND row_key = ?
  `)

  return {
    get(scope: string, key: string) {
      const row = get.get(scope, key)
      if (!row) return undefined
      return { value: (JSON.parse(row.row) as { value: unknown }).value, revision: row.row_revision }
    },
    replace(input: { scope: string; key: string; value: unknown; expectedRevision?: string; txid: string }) {
      if (new TextEncoder().encode(JSON.stringify(input.value)).byteLength > 16 * 1024) throw new SettingTooLarge()
      const authoritative = this.get(input.scope, input.key)
      if (input.expectedRevision !== authoritative?.revision) throw new RevisionConflict(authoritative)
      const revision = crypto.randomUUID()
      const change = collections.write({
        collection: "settings",
        scopeKey: input.scope,
        rowKey: input.key,
        row: { key: input.key, value: input.value, scope: input.scope, revision },
        revision,
        txid: input.txid,
      })
      return { revision, change }
    },
  }
}
