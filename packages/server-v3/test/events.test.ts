import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"
import { createOnlineRequestStore } from "../src/core/online-requests"

describe("collection events", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("starts subscribed scopes with a replacement snapshot", async () => {
    database = createTestDatabase().database
    database.collections.write({ collection: "messages", scopeKey: "session-1", rowKey: "message-1", row: { id: "message-1" }, revision: "1" })
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""

    while (!output.includes("event: snapshot.end")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(output).toContain("event: stream.ready")
    expect(output).toContain("event: snapshot.begin")
    expect(output).toContain('"replace":true')
    expect(output).toContain('"id":"message-1"')
    expect(output).toContain("event: snapshot.end")
  })

  test("publishes rows committed after the snapshot", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4) output += decoder.decode((await reader.read()).value)

    database.collections.write({ collection: "messages", scopeKey: "session-1", rowKey: "message-live", row: { id: "message-live" }, revision: "1" })
    while (!output.includes("message-live")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain("event: rows")
    expect(output).toContain('"id":"message-live"')
  })

  test("keeps every transaction in one rows frame", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4) output += decoder.decode((await reader.read()).value)

    database.collections.replace("messages", "session-1", [
      { key: "message-one", row: { id: "message-one" }, revision: "1" },
      { key: "message-two", row: { id: "message-two" }, revision: "1" },
    ], "tx-one")
    while (!output.includes("message-two")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.match(/event: rows/g)).toHaveLength(1)
    expect(output).toContain('"txid":"tx-one"')
  })

  test("discovers location catalogs added while connected", async () => {
    database = createTestDatabase().database
    const online = createOnlineRequestStore()
    const app = createApp({ database, online })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = await created.json() as { streamId: string }
    await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: true, sessions: [], cursors: {} }),
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 6) output += decoder.decode((await reader.read()).value)

    const location = JSON.stringify({ directory: "/new" })
    database.collections.write({ collection: "locations", scopeKey: "", rowKey: location, row: { directory: "/new" }, revision: "1" })
    online.replace("agents", location, [{ key: "build", row: { id: "build" } }])
    while (!output.includes('"id":"build"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain(`"scopeKey":${JSON.stringify(location)}`)
  })
})

async function createSubscribedStream(app: ReturnType<typeof createApp>) {
  const created = await app.request("/api/collection/streams", { method: "POST" })
  const stream = await created.json() as { streamId: string }
  await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, lists: false, sessions: ["session-1"], cursors: {} }),
  })
  return stream
}
