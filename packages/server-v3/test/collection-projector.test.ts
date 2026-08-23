import { describe, expect, test } from "bun:test"
import { Database } from "@hena/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { reconcileLocations } from "../src/core/collection-projector"

describe("collection projector", () => {
  test("removes an unused location after a session moves", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(sql`
          INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
          VALUES ('global', '/project', 1, 1, '[]')
        `)
        yield* database.run(sql`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_1', 'global', 'session', '/new', 'Session', '1', 1, 1)
        `)
        yield* database.run(sql`
          INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id)
          VALUES (1, 'feed', 0, 'runtime')
        `)
        yield* database.run(sql`
          INSERT INTO collection_row (collection, scope_key, row_key, row, row_revision)
          VALUES ('locations', '', '{"directory":"/old"}', '{"directory":"/old"}', '1')
        `)

        yield* reconcileLocations(database, "tx_1")

        expect(yield* database.all<{ row_key: string }>(sql`
          SELECT row_key FROM collection_row WHERE collection = 'locations' ORDER BY row_key
        `)).toEqual([
          { row_key: '{"directory":"/new"}' },
          { row_key: '{"directory":"/project"}' },
        ])
        expect(yield* database.get(sql`
          SELECT op, row_key FROM collection_change WHERE txid = 'tx_1' AND op = 'delete'
        `)).toEqual({ op: "delete", row_key: '{"directory":"/old"}' })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })
})
