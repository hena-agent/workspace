import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@hena/core/catalog"
import { Integration } from "@hena/core/integration"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { Flag } from "@hena/core/flag/flag"
import { Location } from "@hena/core/location"
import { ModelV2 } from "@hena/core/model"
import { ModelsDev } from "@hena/core/models-dev"
import { ModelsDevPlugin } from "@hena/core/plugin/models-dev"
import { OpenCodePlugin } from "@hena/core/plugin/provider/opencode"
import { ProviderV2 } from "@hena/core/provider"
import { AbsolutePath } from "@hena/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host, integrationHost } from "./host"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const layer = AppNodeBuilder.build(LayerNode.group([Catalog.node, Integration.node, EventV2.node]), [
  [Location.node, locationLayer],
])
const it = testEffect(layer)

describe("ModelsDevPlugin", () => {
  it.effect("projects models.dev modes as separate models instead of variants", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service
      const models = ModelsDev.Service.of({
        get: () =>
          Effect.succeed({
            acme: {
              id: "acme",
              name: "Acme",
              env: [],
              npm: "@ai-sdk/openai-compatible",
              api: "https://api.acme.test/v1",
              models: {
                "gpt-5.4": {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  family: "gpt",
                  release_date: "2026-01-01",
                  attachment: false,
                  reasoning: true,
                  temperature: true,
                  tool_call: true,
                  cost: {
                    input: 2.5,
                    output: 15,
                    tiers: [
                      {
                        tier: { type: "context", size: 272_000 },
                        input: 3,
                        output: 18,
                        cache_read: 0.25,
                      },
                    ],
                    context_over_200k: { input: 5, output: 22.5, cache_read: 0.5 },
                  },
                  limit: { context: 1_050_000, input: 922_000, output: 128_000 },
                  experimental: {
                    modes: {
                      fast: {
                        cost: { input: 5, output: 30, cache_read: 0.5 },
                        provider: {
                          headers: { "x-mode": "fast" },
                          body: { service_tier: "priority" },
                        },
                      },
                    },
                  },
                },
              },
            },
          } satisfies Record<string, ModelsDev.Provider>),
        refresh: () => Effect.void,
      })

      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      ).pipe(Effect.provideService(ModelsDev.Service, models))

      const providerID = ProviderV2.ID.make("acme")
      const base = yield* catalog.model.get(providerID, ModelV2.ID.make("gpt-5.4"))
      const fast = yield* catalog.model.get(providerID, ModelV2.ID.make("gpt-5.4-fast"))

      expect(base?.variants).toEqual([])
      expect(base?.capabilities.reasoning).toBe(true)
      expect(base?.request.body).toEqual({})
      expect(fast).toMatchObject({
        id: "gpt-5.4-fast",
        providerID: "acme",
        name: "GPT-5.4 Fast",
        api: { id: "gpt-5.4" },
        request: {
          headers: { "x-mode": "fast" },
          body: { service_tier: "priority" },
        },
        variants: [],
      })
      expect(fast?.cost).toEqual([
        { input: 5, output: 30, cache: { read: 0.5, write: 0 } },
        {
          tier: { type: "context", size: 272_000 },
          input: 3,
          output: 18,
          cache: { read: 0.25, write: 0 },
        },
        {
          tier: { type: "context", size: 200_000 },
          input: 5,
          output: 22.5,
          cache: { read: 0.5, write: 0 },
        },
      ])
    }),
  )

  it.effect("exposes free opencode models without credentials", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service
      const models = ModelsDev.Service.of({
        get: () =>
          Effect.succeed({
            opencode: {
              id: "opencode",
              name: "OpenCode Zen",
              env: ["OPENCODE_API_KEY"],
              npm: "@ai-sdk/openai",
              api: "https://opencode.ai/zen/v1",
              models: {
                free: model({ id: "free", cost: { input: 0, output: 0 } }),
                paid: model({ id: "paid", cost: { input: 1, output: 1 } }),
                unknown: model({ id: "unknown" }),
              },
            },
          } satisfies Record<string, ModelsDev.Provider>),
        refresh: () => Effect.void,
      })

      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      ).pipe(Effect.provideService(ModelsDev.Service, models))
      yield* OpenCodePlugin.effect(host({ catalog: catalogHost(catalog) }))

      const providerID = ProviderV2.ID.make("opencode")
      expect((yield* catalog.provider.get(providerID))?.request.body.apiKey).toBe(ProviderV2.PUBLIC_API_KEY)
      expect((yield* catalog.model.get(providerID, ModelV2.ID.make("unknown")))?.cost).toEqual([])
      expect((yield* catalog.model.available()).map((item) => item.id)).toEqual([ModelV2.ID.make("free")])

      yield* catalog.transform((draft) => {
        draft.model.default.set(providerID, ModelV2.ID.make("paid"))
      })
      expect((yield* catalog.model.default())?.id).toBe(ModelV2.ID.make("free"))
      expect(yield* catalog.model.small(providerID)).toBeUndefined()

      yield* catalog.transform((draft) => {
        draft.model.update(providerID, ModelV2.ID.make("paid"), (paid) => {
          paid.request.body.apiKey = "model-secret"
        })
      })
      expect((yield* catalog.model.available()).map((item) => item.id)).toEqual([
        ModelV2.ID.make("free"),
        ModelV2.ID.make("paid"),
      ])
      expect((yield* catalog.model.default())?.id).toBe(ModelV2.ID.make("paid"))

      yield* integrations.connection.key({ integrationID: Integration.ID.make("opencode"), key: "secret" })
      expect((yield* catalog.model.available()).map((item) => item.id)).toEqual([
        ModelV2.ID.make("free"),
        ModelV2.ID.make("paid"),
        ModelV2.ID.make("unknown"),
      ])
    }),
  )

  it.effect("registers key methods for providers with environment variables", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.HENA_MODELS_PATH,
          disabled: Flag.HENA_DISABLE_MODELS_FETCH,
        }
        Flag.HENA_MODELS_PATH = path.join(import.meta.dir, "fixtures", "models-dev.json")
        Flag.HENA_DISABLE_MODELS_FETCH = true
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const catalog = yield* Catalog.Service
          yield* ModelsDevPlugin.effect(
            host({
              catalog: catalogHost(catalog),
              integration: integrationHost(integrations),
            }),
          )
          expect(yield* integrations.list()).toEqual([
            new Integration.Info({
              id: Integration.ID.make("acme"),
              name: "Acme",
              methods: [
                { type: "key" },
                {
                  type: "env",
                  names: ["ACME_API_KEY"],
                },
              ],
              connections: [],
            }),
          ])
        }).pipe(Effect.provide(AppNodeBuilder.build(ModelsDev.node))),
      (previous) =>
        Effect.sync(() => {
          Flag.HENA_MODELS_PATH = previous.path
          Flag.HENA_DISABLE_MODELS_FETCH = previous.disabled
        }),
    ),
  )
})

function model(input: { id: string; cost?: { input: number; output: number } }): ModelsDev.Model {
  return {
    ...input,
    name: input.id,
    family: "test",
    release_date: "2026-01-01",
    attachment: false,
    reasoning: true,
    temperature: true,
    tool_call: true,
    limit: { context: 128_000, output: 32_000 },
  }
}
