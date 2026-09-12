import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
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
