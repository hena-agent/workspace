import type { Database } from "bun:sqlite"
import { createChangeStore } from "./changes"
import { createCollectionStore } from "./collections"
import { createFeedStore } from "./feed"
import { createIdempotencyStore } from "./idempotency"
import { migrate } from "./schema"
import { createSettingStore } from "./settings"
import { createContentStore } from "./content"

export function createSyncDatabase(database: Database) {
  database.exec("PRAGMA busy_timeout = 5000")
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA foreign_keys = ON")
  migrate(database)
  const feed = createFeedStore(database)
  const changes = createChangeStore(database, feed)
  const collections = createCollectionStore(database, changes)
  const content = createContentStore(database)

  return {
    raw: database,
    feed,
    changes,
    collections,
    settings: createSettingStore(database, collections),
    content,
    compact(
      input: { now?: number; changeMaxAgeMs?: number; changeMaxRows?: number; idempotencyMaxAgeMs?: number } = {},
    ) {
      return database.transaction(() => {
        const retainedFloor = changes.compact({
          now: input.now ?? Date.now(),
          maxAgeMs: input.changeMaxAgeMs ?? 7 * 24 * 60 * 60_000,
          maxRows: input.changeMaxRows ?? 500_000,
        })
        feed.advanceRetainedFloor(retainedFloor)
        content.compact()
        database
          .query("DELETE FROM idempotency_record WHERE created_at < ?")
          .run((input.now ?? Date.now()) - (input.idempotencyMaxAgeMs ?? 30 * 24 * 60 * 60_000))
        return retainedFloor
      })()
    },
    idempotency: createIdempotencyStore(database, changes),
    close: () => {
      changes.close()
      database.close()
    },
  }
}

export type SyncDatabase = ReturnType<typeof createSyncDatabase>
