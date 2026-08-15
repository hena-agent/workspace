import { LayerNode } from "@hena/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@hena/core/schema"
import { Global } from "@/global"
import { FSUtil } from "@hena/core/fs-util"
import { Flock } from "@hena/core/util/flock"

export const OAUTH_DUMMY_KEY = "hena-oauth-dummy-key"
const AUTH_FILE_LOCK = "auth-file"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
  fedramp: Schema.optional(Schema.Boolean),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly compareAndSetOauth: (key: string, expected: Oauth, info: Oauth) => Effect.Effect<boolean, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@hena/Auth") {}

export function isEnvironmentBacked() {
  if (!process.env.HENA_AUTH_CONTENT) return false
  try {
    JSON.parse(process.env.HENA_AUTH_CONTENT)
    return true
  } catch {
    return false
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.HENA_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.HENA_AUTH_CONTENT)
        } catch {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(AUTH_FILE_LOCK)
          const data = yield* all()
          if (norm !== key) delete data[key]
          delete data[norm + "/"]
          yield* fsys
            .writeJson(file, { ...data, [norm]: info }, 0o600)
            .pipe(Effect.mapError(fail("Failed to write auth data")))
        }),
      )
    })

    const compareAndSetOauth = Effect.fn("Auth.compareAndSetOauth")(function* (
      key: string,
      expected: Oauth,
      info: Oauth,
    ) {
      const norm = key.replace(/\/+$/, "")
      return yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(AUTH_FILE_LOCK)
          if (isEnvironmentBacked()) return false
          const data = yield* all()
          const current = data[norm]
          if (current?.type !== "oauth" || !sameOauth(current, expected)) return false

          delete data[norm + "/"]
          yield* fsys
            .writeJson(file, { ...data, [norm]: info }, 0o600)
            .pipe(Effect.mapError(fail("Failed to write auth data")))
          return true
        }),
      )
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(AUTH_FILE_LOCK)
          const data = yield* all()
          delete data[key]
          delete data[norm]
          yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
        }),
      )
    })

    return Service.of({ get, all, set, compareAndSetOauth, remove })
  }),
)

function sameOauth(left: Oauth, right: Oauth) {
  return (
    left.refresh === right.refresh &&
    left.access === right.access &&
    left.expires === right.expires &&
    left.accountId === right.accountId &&
    left.enterpriseUrl === right.enterpriseUrl &&
    left.fedramp === right.fedramp
  )
}

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

export * as Auth from "."
