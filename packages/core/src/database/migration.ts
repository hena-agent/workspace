export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@hena/effect-drizzle-sqlite"
import { withReservedConnection } from "@hena/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabaseWithClient
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
type ForeignKeyViolation = { table: string; rowid: number | null; parent: string; fkid: number }
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  up: (tx: Transaction) => Effect.Effect<void, unknown>
  disableForeignKeys?: boolean
}

export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      if (yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)) {
        return yield* applyOnly(db, migrations)
      }
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
      yield* applyOnly(db, migrations)
    }),
  )
}

export function applyOnly(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    const completed = yield* initializeJournal(db)

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      yield* applyMigration(db, migration)
    }
  })
}

const initializeJournal = Effect.fn("DatabaseMigration.initializeJournal")(function* (db: Database) {
  const exists = yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"migration"}`)
  if (exists) {
    const completed = yield* readCompleted(db)
    if (completed.size > 0) return completed
  }

  return yield* db.transaction(
    (tx) =>
      Effect.gen(function* () {
        yield* tx.run(
          sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
        )
        const completed = yield* readCompleted(tx)
        if (completed.size > 0) return completed

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
        return yield* readCompleted(tx)
      }),
    { behavior: "immediate" },
  )
})

function readCompleted(db: Pick<Database, "all">) {
  return db
    .all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)
    .pipe(Effect.map((rows) => new Set(rows.map((row) => row.id))))
}

function applyMigration(db: Database, migration: Migration) {
  const migrate = db.transaction(
    (tx) =>
      Effect.gen(function* () {
        // BEGIN IMMEDIATE serializes migration writers across processes. The
        // journal must be checked only after that database-wide lock is held.
        if (yield* tx.get(sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${migration.id}`)) return

        const previousViolations = migration.disableForeignKeys
          ? yield* tx.all<ForeignKeyViolation>(sql`PRAGMA foreign_key_check`)
          : []
        yield* migration.up(tx)
        if (migration.disableForeignKeys) {
          const previous = previousViolations.reduce((counts, violation) => {
            const key = violationKey(violation)
            counts.set(key, (counts.get(key) ?? 0) + 1)
            return counts
          }, new Map<string, number>())
          const violations = (yield* tx.all<ForeignKeyViolation>(sql`PRAGMA foreign_key_check`)).filter((violation) => {
            const key = violationKey(violation)
            const count = previous.get(key) ?? 0
            if (count === 0) return true
            previous.set(key, count - 1)
            return false
          })
          if (violations.length > 0) {
            return yield* Effect.die(
              new Error(`Migration ${migration.id} introduced foreign key violations: ${JSON.stringify(violations)}`),
            )
          }
        }
        yield* tx.run(
          sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
        )
      }),
    { behavior: "immediate" },
  )
  if (!migration.disableForeignKeys) return migrate

  return withReservedConnection(
    db,
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const result = yield* db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)
        if (result?.foreign_keys !== 0 && result?.foreign_keys !== 1) {
          return yield* Effect.die(new Error("SQLite did not return a valid foreign_keys state"))
        }
        yield* db.run(sql`PRAGMA foreign_keys = OFF`)
        return yield* restore(migrate).pipe(
          Effect.ensuring(
            db
              .run(sql`PRAGMA foreign_keys = ${result.foreign_keys === 1 ? sql.raw("ON") : sql.raw("OFF")}`)
              .pipe(Effect.orDie),
          ),
        )
      }),
    ),
  )
}

function violationKey(violation: ForeignKeyViolation) {
  return `${violation.table}:${violation.rowid}:${violation.parent}:${violation.fkid}`
}
