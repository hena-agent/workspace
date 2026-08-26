import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "@hena/schema/agent"
import { Model } from "@hena/schema/model"
import { Provider } from "@hena/schema/provider"
import { createApp } from "../src/app"
import type { CoreDomain } from "../src/core/domain"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"

describe("catalog reads", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("serves a directory's catalog without requiring a known location", async () => {
    database = createTestDatabase().database
    const domain = catalogDomain()
    const response = await createApp({ database, domain }).request(
      "/api/catalog?directory=%2Ftmp%2Fbrand-new-project",
    )

    expect(response.status).toBe(200)
    expect(domain.catalogs).toEqual([{ directory: "/tmp/brand-new-project" }])
    const body = (await response.json()) as {
      agents: Array<{ id: string }>
      models: Array<{ id: string }>
      providers: Array<{ id: string; connected: boolean }>
    }
    expect(body.agents.map((agent) => agent.id)).toEqual(["build"])
    expect(body.models.map((model) => model.id)).toEqual(["model-1"])
    expect(body.providers.map((provider) => provider.id)).toEqual(["provider-1"])
    expect(body.providers[0]?.connected).toBe(true)
    expect(JSON.stringify(body)).not.toContain("secret")
  })

  test("rejects a relative directory", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database, domain: catalogDomain() }).request(
      "/api/catalog?directory=relative%2Fpath",
    )

    expect(response.status).toBe(400)
  })
})

function catalogDomain(): CoreDomain & { catalogs: unknown[] } {
  const catalogs: unknown[] = []
  const unavailable = () => Promise.reject(new Error("unused"))
  const providerID = Provider.ID.make("provider-1")
  return {
    catalogs,
    ready: async () => {},
    createSession: unavailable,
    admitPrompt: unavailable,
    archiveSession: unavailable,
    interrupt: unavailable,
    cancelInput: unavailable,
    reorderInputs: unavailable,
    listFiles: async () => [],
    findFiles: async () => [],
    readFile: unavailable,
    replyPermission: async () => ({ outcome: "applied", resolution: {} }),
    replyQuestion: async () => ({ outcome: "applied", resolution: {} }),
    catalog: async (input) => {
      catalogs.push(input)
      return {
        agents: [{
          ...Agent.Info.empty(Agent.ID.make("build")),
          system: "secret system prompt",
          request: { headers: { Authorization: "secret" }, body: { apiKey: "secret" } },
        }],
        models: [{
          ...Model.Info.empty(providerID, Model.ID.make("model-1")),
          request: { headers: { Authorization: "secret" }, body: { apiKey: "secret" } },
        }],
        providers: [{
          ...Provider.Info.empty(providerID),
          connected: true,
          request: { headers: { Authorization: "secret" }, body: { apiKey: "secret" } },
        }],
      }
    },
    dispose: async () => {},
  }
}
