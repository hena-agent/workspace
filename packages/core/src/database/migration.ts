export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@hena/effect-drizzle-sqlite"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase & { $client: SqlClient }
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  up: (tx: Transaction) => Effect.Effect<void, unknown>
  disableForeignKeys?: boolean
}

export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      const initialized = yield* db.transaction(
        (tx) =>
          Effect.gen(function* () {
            const tables = yield* tx.all<{ name: string }>(
              sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
            )
            if (tables.some((table) => table.name === "session")) return false
            if (tables.length > 0) return yield* Effect.die("Database is not empty and has no session table")

            yield* schema.up(tx)
            yield* tx.run(
              sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
            )
            yield* Effect.forEach(migrations, (migration) =>
              tx.run(
                sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
              ),
            )
            return true
          }),
        { behavior: "immediate" },
      )
      if (initialized) return
      yield* applyOnlyUnlocked(db, migrations)
    }),
  )
}

export function applyOnly(db: Database, input: Migration[]) {
  return applyOnlyUnlocked(db, input)
}

function applyOnlyUnlocked(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    yield* db.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* tx.run(
            sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          if (
            (yield* tx.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM ${sql.identifier("migration")}`))?.count
          )
            return

          // Existing installs used Drizzle's migration journal. Seed the new
          // journal once so TypeScript migrations don't replay old SQL.
          if (
            yield* tx.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
          ) {
            yield* tx.run(sql`
              INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
              SELECT name, ${Date.now()}
              FROM ${sql.identifier("__drizzle_migrations")}
              WHERE name IS NOT NULL
            `)
          }
        }),
      { behavior: "immediate" },
    )

    for (const migration of input) {
      yield* applyMigration(db, migration)
    }
  })
}

function applyMigration(db: Database, migration: Migration) {
  const migrate = db.transaction(
    (tx) =>
      Effect.gen(function* () {
        // BEGIN IMMEDIATE serializes migration writers across processes. The
        // journal must be checked only after that database-wide lock is held.
        if (yield* tx.get(sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${migration.id}`)) return

        yield* migration.up(tx)
        if (migration.disableForeignKeys) {
          const violations = yield* tx.all(sql`PRAGMA foreign_key_check`)
          if (violations.length > 0) return yield* Effect.fail(new Error("Migration introduced foreign key violations"))
        }
        yield* tx.run(
          sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
        )
      }),
    { behavior: "immediate" },
  )
  if (!migration.disableForeignKeys) return migrate

  const client = db.$client
  return Effect.uninterruptibleMask((restore) =>
    Effect.scoped(
      Effect.gen(function* () {
        // PRAGMA foreign_keys is connection-local and SQLite ignores changes
        // after BEGIN, so reserve one connection for the entire rebuild.
        const connection = yield* client.reserve
        const onConnection = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.provideService(effect, client.transactionService, [connection, -1] as const)
        const foreignKeys = yield* onConnection(db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`))
        yield* onConnection(db.run(sql`PRAGMA foreign_keys = OFF`))
        return yield* restore(onConnection(migrate)).pipe(
          Effect.ensuring(
            onConnection(
              db.run(sql`PRAGMA foreign_keys = ${foreignKeys?.foreign_keys === 1 ? sql.raw("ON") : sql.raw("OFF")}`),
            ).pipe(Effect.orDie),
          ),
        )
      }),
    ),
  )
}
