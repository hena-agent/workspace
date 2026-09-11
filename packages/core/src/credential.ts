export * as Credential from "./credential"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
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
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@hena/v2/Credential") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decode = Schema.decodeUnknownSync(Value)
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
          .where(eq(CredentialTable.integration_id, integrationID))
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
