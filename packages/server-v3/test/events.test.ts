import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"
import { createOnlineRequestStore } from "../src/core/online-requests"
import { createDeltaHub } from "../src/stream/delta"

describe("collection events", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("starts subscribed scopes with a replacement snapshot", async () => {
    database = createTestDatabase().database
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "message-1",
      row: { id: "message-1" },
      revision: "1",
    })
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
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)

    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "message-live",
      row: { id: "message-live" },
      revision: "1",
    })
    while (!output.includes("message-live")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain("event: rows")
    expect(output).toContain('"id":"message-live"')
  })

  test("captures initial durable scopes at one sequence", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 1)
      output += decoder.decode((await reader.read()).value)

    database.changes.batch(() => {
      database!.collections.write({
        collection: "messages",
        scopeKey: "session-1",
        rowKey: "message-race",
        row: { id: "message-race" },
        revision: "1",
        txid: "tx-snapshot-race",
      })
      database!.collections.write({
        collection: "parts",
        scopeKey: "session-1",
        rowKey: "part-race",
        row: { id: "part-race" },
        revision: "1",
        txid: "tx-snapshot-race",
      })
    })
    while (!output.includes('"txid":"tx-snapshot-race"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.match(/"id":"part-race"/g)).toHaveLength(1)
  })

  test("streams initial snapshots larger than the live backpressure limit", async () => {
    database = createTestDatabase().database
    Array.from({ length: 5 }, (_, index) =>
      database!.collections.write({
        collection: "messages",
        scopeKey: "session-1",
        rowKey: `message-${index}`,
        row: { id: `message-${index}`, text: "x".repeat(900 * 1024) },
        revision: "1",
      }),
    )
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""

    while (!output.includes("event: snapshot.end")) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += decoder.decode(chunk.value)
    }
    await reader.cancel()

    expect(output).toContain("event: snapshot.end")
    expect(output).not.toContain("slow_consumer")
  })

  test("paces cursor replay beyond the live backpressure limit", async () => {
    database = createTestDatabase().database
    Array.from({ length: 5 }, (_, index) =>
      database!.collections.write({
        collection: "messages",
        scopeKey: "session-1",
        rowKey: `message-${index}`,
        row: { id: `message-${index}`, text: "x".repeat(900 * 1024) },
        revision: "1",
      }),
    )
    const app = createApp({ database })
    const stream = await createSubscribedStream(app, {
      "messages:session-1": { feedId: database.feed.get().feedId, seq: 0 },
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""

    while (!output.includes("message-4") && !output.includes("slow_consumer")) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += decoder.decode(chunk.value)
    }
    await reader.cancel()

    expect(output).toContain("message-4")
    expect(output).not.toContain("slow_consumer")
  })

  test("paces snapshots used to recover oversized transactions", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)

    database.collections.write({
      collection: "todos",
      scopeKey: "session-1",
      rowKey: "ready",
      row: { id: "ready" },
      revision: "1",
    })
    while (!output.includes('"id":"ready"')) output += decoder.decode((await reader.read()).value)
    output = ""
    database.collections.replace(
      "messages",
      "session-1",
      Array.from({ length: 5 }, (_, index) => ({
        key: `message-${index}`,
        row: { id: `message-${index}`, text: "x".repeat(900 * 1024) },
        revision: "1",
      })),
      "tx-large",
    )
    while (!output.includes("message-4") && !output.includes("slow_consumer")) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += decoder.decode(chunk.value)
    }
    await reader.cancel()

    expect(output).toContain("message-4")
    expect(output).not.toContain("slow_consumer")
  })

  test("coalesces queued recovery snapshots by scope", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)
    output = ""

    const rows = (marker: string) =>
      Array.from({ length: 3 }, (_, index) => ({
        key: `${marker}-${index}`,
        row: { id: `${marker}-${index}`, text: marker + "x".repeat(450 * 1024) },
        revision: "1",
      }))
    database.collections.replace("messages", "session-1", rows("first"), "tx-first")
    database.collections.replace("messages", "session-1", rows("second"), "tx-second")

    while (!output.includes("second-2") || !output.slice(output.indexOf("second-2")).includes("event: snapshot.end"))
      output += decoder.decode((await reader.read()).value)
    const trailing = await Promise.race([reader.read(), Bun.sleep(20).then(() => undefined)])
    if (trailing && !trailing.done) output += decoder.decode(trailing.value)
    await reader.cancel()

    expect(output.match(/event: snapshot.begin/g)).toHaveLength(1)
    expect(output).not.toContain("first-2")
    expect(output.match(/event: [^\n]+/g)?.at(-1)).toBe("event: snapshot.end")
  })

  test("buffers deltas until initial snapshots finish", async () => {
    database = createTestDatabase().database
    const deltas = createDeltaHub()
    const app = createApp({ database, deltas })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 1)
      output += decoder.decode((await reader.read()).value)

    deltas.publish({
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      partKind: "text",
      text: "hello",
    })
    while (!output.includes("event: delta")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.slice(0, output.indexOf("event: delta")).match(/event: snapshot.end/g)).toHaveLength(4)
  })

  test("bounds deltas buffered during initial snapshots", async () => {
    database = createTestDatabase().database
    const deltas = createDeltaHub()
    const app = createApp({ database, deltas })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 1)
      output += decoder.decode((await reader.read()).value)

    Array.from({ length: 5 }, () =>
      deltas.publish({
        sessionId: "session-1",
        messageId: "message-1",
        partId: "part-1",
        partKind: "text",
        text: "x".repeat(900 * 1024),
      }),
    )
    while (!output.includes("slow_consumer")) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += decoder.decode(chunk.value)
    }
    await reader.cancel()

    expect(output).toContain("slow_consumer")
    expect(output.match(/event: snapshot.end/g)?.length ?? 0).toBeLessThan(4)
  })

  test("subscribes once per distinct delta session", async () => {
    database = createTestDatabase().database
    const deltas = createDeltaHub()
    const app = createApp({ database, deltas })
    const stream = await createSubscribedStream(app, {}, ["session-1", "session-1"])
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)

    output = ""
    deltas.publish({
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      partKind: "text",
      text: "hello",
    })
    while (!output.includes("part-1")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.match(/event: delta/g)).toHaveLength(1)
  })

  test("replaces a future cursor with a snapshot", async () => {
    database = createTestDatabase().database
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "message-1",
      row: { id: "message-1" },
      revision: "1",
    })
    const app = createApp({ database })
    const stream = await createSubscribedStream(app, {
      "messages:session-1": { feedId: database.feed.get().feedId, seq: 100 },
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while (!output.includes('"id":"message-1"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain("event: snapshot.begin")
    expect(output).not.toContain('"fromSeq":101')
  })

  test("keeps every transaction in one rows frame", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)

    database.collections.replace(
      "messages",
      "session-1",
      [
        { key: "message-one", row: { id: "message-one" }, revision: "1" },
        { key: "message-two", row: { id: "message-two" }, revision: "1" },
      ],
      "tx-one",
    )
    while (!output.includes("message-two")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.match(/event: rows/g)).toHaveLength(1)
    expect(output).toContain('"txid":"tx-one"')
  })

  test("keeps cross-scope transactions in one rows frame", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)

    output = ""
    database.changes.batch(() => {
      database!.collections.write({
        collection: "messages",
        scopeKey: "session-1",
        rowKey: "message-one",
        row: { id: "message-one" },
        revision: "1",
        txid: "tx-cross-scope",
      })
      database!.collections.write({
        collection: "todos",
        scopeKey: "session-1",
        rowKey: "todo-one",
        row: { id: "todo-one" },
        revision: "1",
        txid: "tx-cross-scope",
      })
    })
    while (!output.includes("todo-one")) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.match(/event: rows/g)).toHaveLength(1)
    expect(output).toContain(
      '"affectedScopes":[{"collection":"messages","scopeKey":"session-1"},{"collection":"todos","scopeKey":"session-1"}]',
    )
  })

  test("discovers location catalogs added while connected", async () => {
    database = createTestDatabase().database
    const online = createOnlineRequestStore()
    const app = createApp({ database, online })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = (await created.json()) as { streamId: string }
    await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: true, sessions: [], cursors: {} }),
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 6)
      output += decoder.decode((await reader.read()).value)

    const location = JSON.stringify({ directory: "/new" })
    database.collections.write({
      collection: "locations",
      scopeKey: "",
      rowKey: location,
      row: { directory: "/new" },
      revision: "1",
    })
    database.collections.write({
      collection: "settings",
      scopeKey: location,
      rowKey: "theme",
      row: { value: "dark" },
      revision: "1",
    })
    online.replace("agents", location, [{ key: "build", row: { id: "build" } }])
    while (!output.includes('"id":"build"') || !output.includes('"value":"dark"'))
      output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain(`"scopeKey":${JSON.stringify(location)}`)
  })

  test("clears location catalogs removed while connected", async () => {
    database = createTestDatabase().database
    const online = createOnlineRequestStore()
    const location = JSON.stringify({ directory: "/removed" })
    database.collections.write({
      collection: "locations",
      scopeKey: "",
      rowKey: location,
      row: { directory: "/removed" },
      revision: "1",
    })
    database.collections.write({
      collection: "settings",
      scopeKey: location,
      rowKey: "theme",
      row: { value: "dark" },
      revision: "1",
    })
    online.replace("agents", location, [{ key: "build", row: { id: "build" } }])
    const app = createApp({ database, online })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = (await created.json()) as { streamId: string }
    await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: true, sessions: [], cursors: {} }),
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 10)
      output += decoder.decode((await reader.read()).value)

    output = ""
    database.collections.delete("locations", "", location)
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    for (const collection of ["settings", "agents", "models", "providers"])
      expect(output).toContain(`"scope":{"collection":"${collection}","scopeKey":${JSON.stringify(location)}}`)
    expect(output.match(/"keyCount":0/g)).toHaveLength(4)
    expect(online.snapshot("agents", location).rows).toEqual([])
    expect(online.snapshot("models", location).rows).toEqual([])
    expect(online.snapshot("providers", location).rows).toEqual([])
  })

  test("does not restore initial catalogs after their location is removed", async () => {
    database = createTestDatabase().database
    const online = createOnlineRequestStore()
    const location = JSON.stringify({ directory: "/removed-during-snapshot" })
    database.collections.write({
      collection: "locations",
      scopeKey: "",
      rowKey: location,
      row: { directory: "/removed-during-snapshot" },
      revision: "1",
    })
    database.collections.write({
      collection: "settings",
      scopeKey: location,
      rowKey: "theme",
      row: { value: "stale" },
      revision: "1",
    })
    online.replace("agents", location, [{ key: "stale", row: { id: "stale-agent" } }])
    const app = createApp({ database, online })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = (await created.json()) as { streamId: string }
    await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: true, sessions: [], cursors: {} }),
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 1)
      output += decoder.decode((await reader.read()).value)

    output = ""
    database.collections.delete("locations", "", location)
    while (!output.includes('"op":"delete"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).not.toContain('"value":"stale"')
    expect(output).not.toContain('"id":"stale-agent"')
  })
})

async function createSubscribedStream(
  app: ReturnType<typeof createApp>,
  cursors: Record<string, { feedId: string; seq: number }> = {},
  sessions = ["session-1"],
) {
  const created = await app.request("/api/collection/streams", { method: "POST" })
  const stream = (await created.json()) as { streamId: string }
  await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, lists: false, sessions, cursors }),
  })
  return stream
}
