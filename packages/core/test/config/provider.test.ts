import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DateTime, Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMClient } from "@hena/llm"
import { Catalog } from "@hena/core/catalog"
import { Config } from "@hena/core/config"
import { ConfigProviderPlugin } from "@hena/core/config/plugin/provider"
import { Integration } from "@hena/core/integration"
import { Global } from "@hena/core/global"
import { Location } from "@hena/core/location"
import { ModelV2 } from "@hena/core/model"
import { PluginV2 } from "@hena/core/plugin"
import { PluginHost } from "@hena/core/plugin/host"
import { ProviderV2 } from "@hena/core/provider"
import { ProjectV2 } from "@hena/core/project"
import { SessionRunnerModel } from "@hena/core/session/runner/model"
import { SessionV2 } from "@hena/core/session"
import { AbsolutePath } from "@hena/core/schema"
import { OpenAIPlugin } from "@hena/core/plugin/provider/openai"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (config: Config.Interface) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provideService(Config.Service, config))
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const loadConfig = Effect.fn(function* (defaults = false) {
  const location = yield* Location.Service
  return yield* Config.Service.pipe(
    Effect.provide(Config.locationLayer),
    Effect.provideService(
      Global.Service,
      Global.make(
        defaults
          ? {
              home: location.directory,
              config: path.join(process.env.XDG_CONFIG_HOME!, "hena"),
              data: path.join(process.env.XDG_DATA_HOME!, "hena"),
            }
          : { config: path.join(location.directory, "global"), data: path.join(location.directory, "data") },
      ),
    ),
  )
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

function request(headers: Record<string, string>, variant?: string) {
  return {
    headers,
    variant,
  }
}

const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigProviderPlugin.Plugin", () => {
  it.effect("keeps configured model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.hena
      const modelID = ModelV2.ID.make("alpha-gpt-next")
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  "hena": {
                    api: { type: "aisdk", package: "@ai-sdk/openai", url: "https://hena.test/v1" },
                    models: {
                      "alpha-gpt-next": {
                        variants: [
                          {
                            id: "high",
                            body: {
                              reasoningEffort: "high",
                              reasoningSummary: "auto",
                              include: ["reasoning.encrypted_content"],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              }),
            }),
          ]),
      })

      yield* addPlugin(config)

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.variants).toMatchObject([
        {
          id: "high",
          body: {
            reasoningEffort: "high",
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          },
        },
      ])
    }),
  )

  it.effect("keeps layered model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.hena
      const modelID = ModelV2.ID.make("alpha-gpt-next")
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  "hena": {
                    api: { type: "aisdk", package: "@ai-sdk/openai", url: "https://hena.test/v1" },
                  },
                },
              }),
            }),
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  "hena": {
                    models: {
                      "alpha-gpt-next": {
                        variants: [{ id: "high", body: { reasoningEffort: "high" } }],
                      },
                    },
                  },
                },
              }),
            }),
          ]),
      })

      yield* addPlugin(config)

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.variants[0]).toMatchObject({
        id: "high",
        body: { reasoningEffort: "high" },
      })
    }),
  )

  it.effect("loads configured providers and applies later model overrides", () =>
    withEnv({ CUSTOM_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const integrations = yield* Integration.Service
        const providerID = ProviderV2.ID.make("custom")
        const modelID = ModelV2.ID.make("chat")
        const config = Config.Service.of({
          entries: () =>
            Effect.succeed([
              new Config.Document({
                type: "document",
                info: decode({
                  model: "custom/first",
                  providers: {
                    custom: {
                      name: "Configured",
                      env: ["CUSTOM_API_KEY"],
                      api: { type: "native", settings: {} },
                      request: request({ first: "first", shared: "first" }),
                      models: {
                        chat: {
                          name: "First",
                          capabilities: { tools: true, reasoning: true, input: ["text"], output: ["text"] },
                          disabled: true,
                          limit: { context: 100, output: 50 },
                          cost: { input: 1, output: 2 },
                          request: request({ first: "first", shared: "first" }, "retained"),
                          variants: [
                            {
                              id: "fast",
                              headers: { first: "first", shared: "first" },
                            },
                          ],
                        },
                      },
                    },
                  },
                }),
              }),
              new Config.Document({
                type: "document",
                info: decode({
                  model: "custom/default",
                  providers: {
                    custom: {
                      api: { type: "aisdk", package: "custom-sdk", url: "https://example.test" },
                      request: request({ last: "last", shared: "last" }),
                      models: {
                        default: {
                          name: "Default",
                        },
                        chat: {
                          api: { id: "api-chat" },
                          name: "Last",
                          capabilities: { tools: true, input: ["text"], output: ["text"] },
                          limit: { output: 75 },
                          request: request({ last: "last", shared: "last" }),
                          variants: [
                            {
                              id: "fast",
                              headers: { last: "last", shared: "last" },
                            },
                            {
                              id: "slow",
                              headers: { slow: "slow" },
                            },
                          ],
                        },
                      },
                    },
                  },
                }),
              }),
              new Config.Document({
                type: "document",
                info: decode({
                  providers: {
                    custom: { name: "Renamed" },
                  },
                }),
              }),
            ]),
        })

        yield* addPlugin(config)

        const provider = required(yield* catalog.provider.get(providerID))
        const model = required(yield* catalog.model.get(providerID, modelID))
        expect((yield* catalog.model.default())?.id).toBe(ModelV2.ID.make("default"))
        expect(provider.name).toBe("Renamed")
        expect((yield* integrations.get(Integration.ID.make("custom")))?.methods).toContainEqual({
          type: "env",
          names: ["CUSTOM_API_KEY"],
        })
        expect((yield* integrations.get(Integration.ID.make("custom")))?.name).toBe("Renamed")
        expect(provider.disabled).toBeUndefined()
        expect(provider.api).toEqual({ type: "aisdk", package: "custom-sdk", url: "https://example.test" })
        expect(provider.request.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.api.id).toBe(ModelV2.ID.make("api-chat"))
        expect(model.name).toBe("Last")
        expect(model.capabilities).toEqual({ tools: true, reasoning: true, input: ["text"], output: ["text"] })
        expect(model.enabled).toBe(false)
        expect(model.limit).toEqual({ context: 100, output: 75 })
        expect(model.cost).toEqual([{ input: 1, output: 2, cache: { read: 0, write: 0 }, tier: undefined }])
        expect(model.request.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.request.variant).toBe("retained")
        expect(model.variants.map((variant) => variant.id)).toEqual([
          ModelV2.VariantID.make("fast"),
          ModelV2.VariantID.make("slow"),
        ])
        expect(model.variants[0]?.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.variants[1]?.headers).toEqual({ slow: "slow" })
      }),
    ),
  )

  it.effect("resolves an imported custom provider without exposing its private settings", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(location.directory, "opencode.json"),
          JSON.stringify({
            provider: {
              custom: {
                npm: "@ai-sdk/openai-compatible",
                options: {
                  apiKey: "provider-test-key",
                  baseURL: "https://custom.example/v1",
                  headers: { "x-safe": "safe", Authorization: "Bearer private-header-test-key" },
                  timeout: 1000,
                },
                models: {
                  chat: {
                    options: {
                      apiKey: "model-test-key",
                      headers: { "x-api-key": "private-model-header-test-key" },
                      reasoningEffort: "high",
                    },
                  },
                },
              },
            },
          }),
        ),
      )
      const config = yield* loadConfig()
      yield* addPlugin(config)

      const catalog = yield* Catalog.Service
      const provider = required(yield* catalog.provider.get(ProviderV2.ID.make("custom")))
      const model = required(yield* catalog.model.get(ProviderV2.ID.make("custom"), ModelV2.ID.make("chat")))
      expect(provider.api).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://custom.example/v1",
        settings: { timeout: 1000 },
      })
      expect(model.request.body).toEqual({ reasoning_effort: "high" })
      expect(JSON.stringify(yield* config.entries())).not.toContain("test-key")
      expect(JSON.stringify(provider)).not.toContain("test-key")
      expect(JSON.stringify(model)).not.toContain("test-key")

      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_legacy_provider"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: { providerID: ProviderV2.ID.make("custom"), id: ModelV2.ID.make("chat") },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make(location.directory) },
      })
      const resolved = yield* SessionRunnerModel.Service.pipe(
        Effect.flatMap((service) => service.resolve(session)),
        Effect.provide(SessionRunnerModel.locationLayer),
        Effect.orDie,
      )
      const llmRequest = LLM.request({ model: resolved, prompt: "Hello" })
      const prepared = yield* LLMClient.prepare<Record<string, unknown>>(llmRequest)
      const transport = yield* resolved.route.prepareTransport(
        prepared.body,
        LLM.updateRequest(llmRequest, { http: resolved.route.defaults.http }),
      )
      const web = yield* HttpClientRequest.toWeb(transport.request).pipe(Effect.orDie)

      expect(resolved.route.endpoint?.baseURL).toBe("https://custom.example/v1")
      expect(web.url).toBe("https://custom.example/v1/chat/completions")
      expect(web.headers.get("authorization")).toBe("Bearer model-test-key")
      expect(web.headers.get("x-api-key")).toBe("private-model-header-test-key")
      expect(web.headers.get("x-safe")).toBe("safe")
      expect(prepared.body).toMatchObject({ messages: [{ role: "user", content: "Hello" }], stream: true })
    }),
  )

  it.effect("refreshes parsed OpenCode OAuth through the installed OpenAI integration", () =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        const location = yield* Location.Service
        const previous = {
          auth: process.env.OPENCODE_AUTH_CONTENT,
          config: process.env.XDG_CONFIG_HOME,
          data: process.env.XDG_DATA_HOME,
          fetch: globalThis.fetch,
        }
        delete process.env.OPENCODE_AUTH_CONTENT
        process.env.XDG_CONFIG_HOME = path.join(location.directory, ".config")
        process.env.XDG_DATA_HOME = path.join(location.directory, ".local", "share")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(process.env.XDG_DATA_HOME!, "opencode"), { recursive: true })
          await fs.writeFile(
            path.join(process.env.XDG_DATA_HOME!, "opencode", "auth.json"),
            JSON.stringify({
              openai: {
                type: "oauth",
                access: "expired-access",
                refresh: "refresh-token",
                expires: 0,
                accountId: "account-id",
              },
            }),
          )
          await fs.writeFile(
            path.join(location.directory, "opencode.json"),
            JSON.stringify({
              provider: {
                openai: {
                  npm: "@ai-sdk/openai",
                  options: { baseURL: "https://api.openai.com/v1" },
                  models: { "gpt-5": {} },
                },
              },
            }),
          )
        })
        const requests: string[] = []
        globalThis.fetch = Object.assign(
          async (input: string | URL | Request) => {
            requests.push(String(input))
            return new Response(
              JSON.stringify({
                id_token: "header.payload.signature",
                access_token: "refreshed-access",
                refresh_token: "refreshed-token",
                expires_in: 3600,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            )
          },
          { preconnect: () => {} },
        )
        return { previous, requests }
      }),
      ({ requests }) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          const config = yield* loadConfig(true)
          const plugin = yield* PluginV2.Service
          const host = yield* PluginHost.make(plugin)
          yield* OpenAIPlugin.effect(host)
          yield* addPlugin(config)

          const integrations = yield* Integration.Service
          const connection = required(yield* integrations.connection.active(Integration.ID.make("openai")))
          const credential = yield* integrations.connection.resolve(connection).pipe(Effect.orDie)

          expect(credential).toMatchObject({ type: "oauth", access: "refreshed-access" })
          expect(requests).toEqual(["https://auth.openai.com/oauth/token"])
          expect(JSON.stringify(yield* config.entries())).not.toContain("expired-access")
          expect(JSON.stringify(yield* config.entries())).not.toContain("refresh-token")

          const selected = required(
            yield* (yield* Catalog.Service).model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5")),
          )
          const session = SessionV2.Info.make({
            id: SessionV2.ID.make("ses_opencode_oauth"),
            projectID: ProjectV2.ID.global,
            title: "test",
            model: { providerID: selected.providerID, id: selected.id },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
            location: { directory: AbsolutePath.make(location.directory) },
          })
          const resolved = yield* SessionRunnerModel.Service.pipe(
            Effect.flatMap((service) => service.resolve(session)),
            Effect.provide(SessionRunnerModel.locationLayer),
            Effect.orDie,
          )
          const request = LLM.request({
            model: resolved,
            system: "System instructions",
            prompt: "Hello",
            generation: { maxTokens: 12 },
          })
          const prepared = yield* LLMClient.prepare<Record<string, unknown>>(request)
          const transport = yield* resolved.route.prepareTransport(
            prepared.body,
            LLM.updateRequest(request, { http: resolved.route.defaults.http }),
          )
          const web = yield* HttpClientRequest.toWeb(transport.request).pipe(Effect.orDie)

          expect(web.url).toBe("https://chatgpt.com/backend-api/codex/responses")
          expect(web.headers.get("authorization")).toBe("Bearer refreshed-access")
          expect(web.headers.get("ChatGPT-Account-ID")).toBe("account-id")
          expect(prepared.body).toMatchObject({
            store: false,
            stream: true,
            instructions: "System instructions",
            input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
          })
          expect(prepared.body).not.toHaveProperty("max_output_tokens")
        }),
      ({ previous }) =>
        Effect.sync(() => {
          globalThis.fetch = previous.fetch
          if (previous.auth === undefined) delete process.env.OPENCODE_AUTH_CONTENT
          else process.env.OPENCODE_AUTH_CONTENT = previous.auth
          if (previous.config === undefined) delete process.env.XDG_CONFIG_HOME
          else process.env.XDG_CONFIG_HOME = previous.config
          if (previous.data === undefined) delete process.env.XDG_DATA_HOME
          else process.env.XDG_DATA_HOME = previous.data
        }),
    ),
  )
})
