import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import path from "path"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { Database } from "@hena/core/database/database"
import { tmpdir } from "./fixture/tmpdir"
import { Credential } from "@hena/core/credential"
import { LayerNode } from "@hena/core/effect/layer-node"
import { Integration } from "@hena/core/integration"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Credential.node))

describe("Credential", () => {
  for (const mutation of ["remove", "replace", "update", "rename", "already removed"] as const) {
    it.effect(`handles ${mutation} when persisting an OAuth refresh`, () =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const value = Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "expired",
          refresh: "original",
          expires: 0,
        })
        const input = yield* credentials.create({ integrationID: Integration.ID.make("openai"), value })
        if (mutation === "already removed") yield* credentials.remove(input.id)
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const refreshed = Credential.OAuth.make({ ...value, access: "fresh", refresh: "rotated", expires: 3_600_000 })
        const fiber = yield* credentials
          .refresh({ ...input, value }, () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(refreshed)),
          )
          .pipe(Effect.forkScoped)
        yield* Deferred.await(started)
        yield* Effect.gen(function* () {
          if (mutation === "remove" || mutation === "already removed") return yield* credentials.remove(input.id)
          if (mutation === "replace")
            return yield* credentials.create({
              integrationID: input.integrationID,
              value: Credential.Key.make({ type: "key", key: "replacement" }),
            })
          if (mutation === "update")
            return yield* credentials.update(input.id, {
              value: Credential.OAuth.make({ ...value, access: "updated", refresh: "updated" }),
            })
          yield* credentials.update(input.id, { label: "Renamed" })
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
        expect(yield* Fiber.join(fiber)).toEqual(refreshed)
        const saved = yield* credentials.list(input.integrationID)
        if (mutation === "remove" || mutation === "already removed") {
          expect(yield* credentials.get(input.id)).toBeUndefined()
          expect(saved).toEqual([])
          return
        }
        expect(saved).toHaveLength(1)
        if (mutation === "replace") {
          expect(yield* credentials.get(input.id)).toBeUndefined()
          expect(saved[0]?.value).toEqual({ type: "key", key: "replacement" })
          return
        }
        if (mutation === "update") {
          expect(saved[0]?.value).toEqual({ ...value, access: "updated", refresh: "updated" })
          return
        }
        expect(saved[0]).toMatchObject({ id: input.id, label: "Renamed", value: refreshed })
      }),
    )
  }

  it.effect("does not restore an import replaced during OAuth refresh", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const input = {
        id: Credential.ID.make("legacy:openai:source"),
        imported: true,
        integrationID: Integration.ID.make("openai"),
        label: "OpenCode",
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "expired",
          refresh: "original",
          expires: 0,
        }),
      }
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const refreshed = Credential.OAuth.make({
        ...input.value,
        access: "fresh",
        refresh: "rotated",
        expires: 3_600_000,
      })
      const fiber = yield* credentials
        .refresh(input, () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(refreshed)),
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      const replacement = yield* credentials.create({
        integrationID: input.integrationID,
        value: Credential.Key.make({ type: "key", key: "replacement" }),
      })
      yield* Deferred.succeed(release, undefined)

      expect(yield* Fiber.join(fiber)).toEqual(refreshed)
      expect(yield* credentials.get(input.id)).toBeUndefined()
      expect(yield* credentials.list(input.integrationID)).toEqual([replacement])
    }),
  )

  testEffect(Layer.empty).live("keeps rotated imports after closing and reopening the credential database", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const layer = AppNodeBuilder.build(Credential.node, [
        [Database.node, Database.layerFromPath(path.join(tmp.path, "auth.sqlite"))],
      ])
      const input = {
        id: Credential.ID.make("legacy:openai:source"),
        imported: true,
        integrationID: Integration.ID.make("openai"),
        label: "OpenCode",
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "expired",
          refresh: "original",
          expires: 0,
        }),
      }
      yield* Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.refresh(input, (value) =>
          Effect.succeed(
            Credential.OAuth.make({ ...value, access: "fresh", refresh: "rotated", expires: Date.now() + 3_600_000 }),
          ),
        )
      }).pipe(Effect.provide(Layer.fresh(layer)), Effect.scoped)
      yield* Effect.gen(function* () {
        const credentials = yield* Credential.Service
        expect(yield* credentials.refresh(input, () => Effect.die("must not reuse the original token"))).toMatchObject({
          access: "fresh",
          refresh: "rotated",
        })
        expect(yield* credentials.all()).toEqual([])
      }).pipe(Effect.provide(Layer.fresh(layer)), Effect.scoped)
    }),
  )

  it.effect("stores, updates, lists, and removes credentials", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect(yield* credentials.list(integrationID)).toEqual([created])
      yield* credentials.update(created.id, { label: "Personal" })
      expect((yield* credentials.list(integrationID))[0]?.label).toBe("Personal")

      const replacement = yield* credentials.create({
        integrationID,
        label: "Replacement",
        value: Credential.Key.make({ type: "key", key: "replacement" }),
      })
      expect(yield* credentials.list(integrationID)).toEqual([replacement])

      yield* credentials.remove(replacement.id)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )
})
