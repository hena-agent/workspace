export * as Credential from "./credential"

import { and, asc, eq, notLike } from "drizzle-orm"
import { Clock, Context, Duration, Effect, Layer, Schema } from "effect"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Credential } from "@hena/schema/credential"
import { Integration } from "@hena/schema/integration"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { CredentialTable } from "./credential/sql"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const Value = Credential.Value
export type Value = Credential.Value

const compatibilityKey = "__hena_legacy_provider"

export type CompatibilityRequest = {
  readonly headers?: Readonly<Record<string, string>>
  readonly apiKey?: string
  readonly authorizationOnly?: boolean
}

export type Compatibility = CompatibilityRequest & {
  readonly models?: Readonly<Record<string, CompatibilityRequest>>
}

export function withCompatibility(value: Value, compatibility: Compatibility): Value {
  return { ...value, metadata: { ...value.metadata, [compatibilityKey]: compatibility } }
}

export function getCompatibility(value: Value | undefined): Compatibility | undefined {
  const compatibility = value?.metadata?.[compatibilityKey]
  if (!isRecord(compatibility)) return
  const models = isRecord(compatibility.models)
    ? Object.fromEntries(
        Object.entries(compatibility.models).flatMap(([id, request]) => {
          const decoded = compatibilityRequest(request)
          return decoded ? [[id, decoded]] : []
        }),
      )
    : undefined
  return {
    ...compatibilityRequest(compatibility),
    ...(models && Object.keys(models).length ? { models } : {}),
  }
}

export function getRequestMetadata(value: Value | undefined) {
  if (value?.type !== "key" || !value.metadata) return
  const metadata = Object.fromEntries(Object.entries(value.metadata).filter(([key]) => key !== compatibilityKey))
  return Object.keys(metadata).length ? metadata : undefined
}

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
}) {}

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Replaces any credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
  }) => Effect.Effect<Info>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Only an imported credential may be persisted when no stored record exists. */
  readonly refresh: <E, R>(
    input: Info & { value: OAuth; imported?: boolean },
    refresh: (value: OAuth) => Effect.Effect<OAuth, E, R>,
  ) => Effect.Effect<OAuth, E, R>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@hena/v2/Credential") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decode = Schema.decodeUnknownSync(Value)
    const refreshes = KeyedMutex.makeUnsafe<ID>()
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      return new Info({
        id: row.id,
        integrationID: row.integration_id,
        label: row.label,
        value: decode(row.value),
      })
    }

    return Service.of({
      all: Effect.fn("Credential.all")(function* () {
        return (yield* db
          .select()
          .from(CredentialTable)
          .where(notLike(CredentialTable.id, "legacy:%"))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      list: Effect.fn("Credential.list")(function* (integrationID) {
        return (yield* db
          .select()
          .from(CredentialTable)
          .where(and(eq(CredentialTable.integration_id, integrationID), notLike(CredentialTable.id, "legacy:%")))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      get: Effect.fn("Credential.get")(function* (id) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Info({
          id: ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: credential.value,
                })
                .run()
            }),
          )
          .pipe(Effect.orDie)
        return credential
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: updates.value })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
      refresh: (input, refresh) =>
        refreshes.withLock(input.id)(
          Effect.gen(function* () {
            const row = yield* db
              .select()
              .from(CredentialTable)
              .where(eq(CredentialTable.id, input.id))
              .get()
              .pipe(Effect.orDie)
            const explicit =
              !row && input.imported
                ? yield* db
                    .select({ id: CredentialTable.id })
                    .from(CredentialTable)
                    .where(
                      and(
                        eq(CredentialTable.integration_id, input.integrationID),
                        notLike(CredentialTable.id, "legacy:%"),
                      ),
                    )
                    .get()
                    .pipe(Effect.orDie)
                : undefined
            const current = row ? decode(row.value) : input.value
            if (current.type !== "oauth") return yield* Effect.die("Credential is no longer OAuth")
            if (current.expires > (yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.minutes(5)))
              return current
            const value = yield* refresh(current)
            const metadata = Object.fromEntries(
              Object.entries(value.metadata ?? {}).filter(([key]) => key !== compatibilityKey),
            )
            const storedValue = { ...value, metadata: Object.keys(metadata).length ? metadata : undefined }
            // Only persist if the stored secret still belongs to this refresh.
            if (row)
              yield* db
                .update(CredentialTable)
                .set({ value: storedValue })
                .where(and(eq(CredentialTable.id, input.id), eq(CredentialTable.value, row.value)))
                .run()
                .pipe(Effect.orDie)
            // Only imports may start without a row; never recreate a missing explicit credential.
            if (!row && input.imported)
              yield* db
                .transaction((tx) =>
                  Effect.gen(function* () {
                    const existing = yield* tx
                      .select({ id: CredentialTable.id })
                      .from(CredentialTable)
                      .where(
                        and(
                          eq(CredentialTable.integration_id, input.integrationID),
                          notLike(CredentialTable.id, "legacy:%"),
                        ),
                      )
                      .get()
                    if (existing?.id !== explicit?.id) return
                    yield* tx
                      .insert(CredentialTable)
                      .values({
                        id: input.id,
                        integration_id: input.integrationID,
                        label: input.label,
                        value: storedValue,
                      })
                      .onConflictDoNothing({ target: CredentialTable.id })
                      .run()
                  }),
                )
                .pipe(Effect.orDie)
            return value
          }).pipe(Effect.uninterruptible),
        ),
      remove: Effect.fn("Credential.remove")(function* (id) {
        yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id)).run().pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

function compatibilityRequest(input: unknown): CompatibilityRequest | undefined {
  if (!isRecord(input)) return
  const headers = isRecord(input.headers)
    ? Object.fromEntries(
        Object.entries(input.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined
  return {
    ...(headers && Object.keys(headers).length ? { headers } : {}),
    ...(typeof input.apiKey === "string" ? { apiKey: input.apiKey } : {}),
    ...(input.authorizationOnly === true ? { authorizationOnly: true } : {}),
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
