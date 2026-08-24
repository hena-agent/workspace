import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { createApp } from "../src/app"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"
import { createOnlineRequestStore } from "../src/core/online-requests"
import { createDeltaHub } from "../src/stream/delta"
import { createStreamRegistry } from "../src/stream/registry"
import { createStreamRoutes } from "../src/routes/streams"

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

  test("detaches streams when initialization fails", async () => {
    database = createTestDatabase().database
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "message-1",
      row: { id: "message-1" },
      revision: "1",
    })
    database.raw
      .query("UPDATE collection_row SET row = ? WHERE collection = ? AND scope_key = ? AND row_key = ?")
      .run("{", "messages", "session-1", "message-1")
    let now = 0
    const streams = createStreamRegistry({ graceMs: 1, maxResourcesPerPrincipal: 1, now: () => now })
    const app = new Hono().route(
      "/api/collection",
      createStreamRoutes(database, streams, createDeltaHub(), createOnlineRequestStore()),
    )
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = (await created.json()) as { streamId: string }
    await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: false, sessions: ["session-1"], cursors: {} }),
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    while (!(await reader.read()).done) {}
    now = 2

    expect(streams.get("local", stream.streamId)).toBeUndefined()
  })

  test("decodes composite part keys in snapshots and deletes", async () => {
    database = createTestDatabase().database
    const key = JSON.stringify(["msg_1", "text", "part_1"])
    database.collections.write({
      collection: "parts",
      scopeKey: "session-1",
      rowKey: key,
      row: { id: "part_1" },
      revision: "1",
    })
    const app = createApp({ database })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while (!output.includes('"key":["msg_1","text","part_1"]')) output += decoder.decode((await reader.read()).value)

    database.collections.delete("parts", "session-1", key)
    while (!output.includes('"rowKey":["msg_1","text","part_1"]')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).not.toContain(`"rowKey":${JSON.stringify(key)}`)
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

  test("does not overwrite a location added during the initial snapshot", async () => {
    database = createTestDatabase().database
    Array.from({ length: 5 }, (_, index) =>
      database!.collections.write({
        collection: "projects",
        scopeKey: "",
        rowKey: `project-${index}`,
        row: { id: `project-${index}`, text: "x".repeat(900 * 1024) },
        revision: "1",
      }),
    )
    const app = createApp({ database })
    const stream = await createSubscribedStream(app, {}, [], true)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while (!output.includes("event: snapshot.page")) output += decoder.decode((await reader.read()).value)

    const location = JSON.stringify({ directory: "/late" })
    database.changes.batch(() => {
      database!.collections.write({
        collection: "locations",
        scopeKey: "",
        rowKey: location,
        row: { directory: "/late" },
        revision: "1",
      })
      database!.collections.write({
        collection: "settings",
        scopeKey: location,
        rowKey: "theme",
        row: { value: "current" },
        revision: "1",
      })
    })
    const providerEnd = `"type":"snapshot.end","scope":{"collection":"providers","scopeKey":${JSON.stringify(location)}}`
    while (!output.includes(providerEnd)) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    const settingsBegin = `"type":"snapshot.begin","scope":{"collection":"settings","scopeKey":${JSON.stringify(location)}}`
    expect(output.split(settingsBegin)).toHaveLength(2)
    expect(output).toContain('"value":"current"')
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

  test("limits concurrent initial snapshot readers", async () => {
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
    const streams = await Promise.all(Array.from({ length: 9 }, () => createSubscribedStream(app)))
    const responses = await Promise.all(
      streams.map((stream) => Promise.resolve(app.request(`/api/collection/streams/${stream.streamId}/events`))),
    )
    const output = await Promise.race([
      new Response(responses.at(-1)!.body).text(),
      Bun.sleep(2_000).then(() => "timeout"),
    ])
    await Promise.all(responses.slice(0, -1).flatMap((response) => (response.body ? [response.body.cancel()] : [])))

    expect(output).toContain("stream_limit_exceeded")
  })

  test("releases the snapshot transaction when the client disconnects", async () => {
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
    while (!output.includes("event: snapshot.page")) output += decoder.decode((await reader.read()).value)
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "message-live",
      row: { id: "message-live" },
      revision: "1",
    })
    await reader.cancel()
    await Bun.sleep(10)

    expect(database.raw.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get()!.busy).toBe(0)
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

  test("detects oversized replay transactions before parsing their rows", async () => {
    database = createTestDatabase().database
    database.collections.replace(
      "messages",
      "session-1",
      Array.from({ length: 6 }, (_, index) => ({
        key: `message-${index}`,
        row: { id: `message-${index}`, text: "x".repeat(900 * 1024) },
        revision: "1",
      })),
      "tx-large-replay",
    )
    database.raw
      .query("UPDATE collection_change SET row = ? WHERE txid = ? AND row_key = ?")
      .run("{", "tx-large-replay", "message-0")
    const app = createApp({ database })
    const stream = await createSubscribedStream(app, {
      "messages:session-1": { feedId: database.feed.get().feedId, seq: 0 },
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while (!output.includes("message-5")) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += decoder.decode(chunk.value)
    }
    await reader.cancel()

    expect(output).toContain("message-5")
    expect(output).toContain('"op":"reset"')
  })

  test("replays against the attachment snapshot before buffered writes", async () => {
    database = createTestDatabase().database
    database.collections.replace(
      "messages",
      "session-1",
      Array.from({ length: 5 }, (_, index) => ({
        key: `large-${index}`,
        row: { id: `large-${index}`, text: "x".repeat(900 * 1024) },
        revision: "1",
      })),
      "tx-large",
    )
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "target",
      row: { id: "target", marker: "old" },
      revision: "2",
      txid: "tx-old",
    })
    const app = createApp({ database })
    const stream = await createSubscribedStream(app, {
      "messages:session-1": { feedId: database.feed.get().feedId, seq: 0 },
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = decoder.decode((await reader.read()).value)

    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "target",
      row: { id: "target", marker: "new" },
      revision: "3",
      txid: "tx-new",
    })
    while (!output.includes('"marker":"new"')) output += decoder.decode((await reader.read()).value)
    await Bun.sleep(20)
    const trailing = await Promise.race([reader.read(), Bun.sleep(20).then(() => undefined)])
    if (trailing && !trailing.done) output += decoder.decode(trailing.value)
    await reader.cancel()

    expect(output.lastIndexOf('"marker":"new"')).toBeGreaterThan(output.lastIndexOf('"marker":"old"'))
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
    expect(output).toContain('"txid":"tx-first"')
    expect(output).toContain('"txid":"tx-second"')
    expect(output.match(/event: [^\n]+/g)?.at(-1)).toBe("event: snapshot.end")
  })

  test("orders later recoveries after already queued row frames", async () => {
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
      Array.from({ length: 5 }, (_, index) => ({
        key: index === 0 ? "target" : `${marker}-${index}`,
        row: { id: index === 0 ? "target" : `${marker}-${index}`, marker, text: "x".repeat(900 * 1024) },
        revision: marker,
      }))

    database.collections.replace("messages", "session-1", rows("first"), "tx-first")
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "target",
      row: { id: "target", marker: "middle" },
      revision: "middle",
      txid: "tx-middle",
    })
    database.collections.replace("messages", "session-1", rows("final"), "tx-final")
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 2)
      output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain('"marker":"final"')
    expect(output).not.toContain('"marker":"middle"')
  })

  test("does not replay rows already covered by a recovery snapshot", async () => {
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
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "after",
      row: { id: "after" },
      revision: "1",
      txid: "tx-after",
    })
    while (!output.includes('"id":"after"') || !output.includes("event: snapshot.end"))
      output += decoder.decode((await reader.read()).value)
    const trailing = await Promise.race([reader.read(), Bun.sleep(20).then(() => undefined)])
    if (trailing && !trailing.done) output += decoder.decode(trailing.value)
    await reader.cancel()

    expect(output.match(/"id":"after"/g)).toHaveLength(1)
  })

  test("drains pending recoveries before newer row frames", async () => {
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
      Array.from({ length: 5 }, (_, index) => ({
        key: index === 0 ? "target" : `${marker}-${index}`,
        row: { id: index === 0 ? "target" : `${marker}-${index}`, marker, text: "x".repeat(900 * 1024) },
        revision: marker,
      }))

    database.collections.replace("messages", "session-1", rows("first"), "tx-first")
    while (!output.includes("event: snapshot.begin")) output += decoder.decode((await reader.read()).value)
    database.collections.replace("messages", "session-1", rows("second"), "tx-second")
    database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "target",
      row: { id: "target", marker: "newer" },
      revision: "newer",
      txid: "tx-newer",
    })
    while (!output.includes('"marker":"newer"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.indexOf('"marker":"second"')).toBeGreaterThan(-1)
    expect(output.indexOf('"marker":"second"')).toBeLessThan(output.indexOf('"marker":"newer"'))
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

  test("splits large delta frames on UTF-8 boundaries", async () => {
    database = createTestDatabase().database
    const deltas = createDeltaHub()
    const app = createApp({ database, deltas })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await reader.read()).value)
    output = ""
    const text = "é".repeat(600 * 1024)

    deltas.publish({
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      partKind: "text",
      text,
    })
    while ((output.match(/event: delta/g)?.length ?? 0) < 3) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    const frames = output
      .match(/^data: .+$/gm)!
      .map((line): unknown => JSON.parse(line.slice(6)))
      .filter(
        (value): value is { type: "delta"; offset: number; text: string } =>
          typeof value === "object" &&
          value !== null &&
          "type" in value &&
          value.type === "delta" &&
          "offset" in value &&
          typeof value.offset === "number" &&
          "text" in value &&
          typeof value.text === "string",
      )
    expect(frames.map((value) => value.offset)).toEqual([0, 512 * 1024, 1024 * 1024])
    expect(frames.map((value) => value.text).join("")).toBe(text)
    expect(frames.every((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength < 1024 * 1024)).toBe(true)
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
    let disconnected = false
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
      if (chunk.done) {
        disconnected = true
        break
      }
      output += decoder.decode(chunk.value)
    }
    await reader.cancel()

    expect(disconnected || output.includes("slow_consumer")).toBe(true)
    expect(output.match(/event: snapshot.end/g)?.length ?? 0).toBeLessThan(4)
  })

  test("disconnects slow consumers without waiting for stalled writes", async () => {
    database = createTestDatabase().database
    const deltas = createDeltaHub()
    const app = createApp({ database, deltas })
    const stream = await createSubscribedStream(app)
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()

    Array.from({ length: 5 }, (_, index) =>
      deltas.publish({
        sessionId: "session-1",
        messageId: "message-1",
        partId: `part-${index}`,
        partKind: "text",
        text: "x".repeat(900 * 1024),
      }),
    )
    const first = await Promise.race([reader.read(), Bun.sleep(1_000).then(() => undefined)])
    const second = first?.done ? first : await Promise.race([reader.read(), Bun.sleep(1_000).then(() => undefined)])
    await reader.cancel()

    expect(second?.done).toBe(true)
  })

  test("aborts superseded streams during snapshot writes", async () => {
    database = createTestDatabase().database
    const source = createOnlineRequestStore()
    let subscriptions = 0
    let totalSubscriptions = 0
    const online = {
      ...source,
      subscribe(listener: Parameters<typeof source.subscribe>[0]) {
        subscriptions++
        totalSubscriptions++
        const unsubscribe = source.subscribe(listener)
        return () => {
          subscriptions--
          return unsubscribe()
        }
      },
    }
    const app = createApp({ database, online })
    const stream = await createSubscribedStream(app)
    const first = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const firstReader = first.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 4)
      output += decoder.decode((await firstReader.read()).value)
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
    while (!output.includes("event: snapshot.page")) output += decoder.decode((await firstReader.read()).value)

    const second = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    await Bun.sleep(10)

    expect(totalSubscriptions).toBe(2)
    expect(subscriptions).toBe(1)

    await second.body!.cancel()
    await firstReader.cancel()
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

  test("does not replay changes covered by a dynamically added scope snapshot", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
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
    output = ""
    const location = JSON.stringify({ directory: "/new" })

    database.changes.batch(() => {
      database!.collections.write({
        collection: "locations",
        scopeKey: "",
        rowKey: location,
        row: { directory: "/new" },
        revision: "1",
        txid: "tx-location",
      })
      database!.collections.write({
        collection: "settings",
        scopeKey: location,
        rowKey: "theme",
        row: { value: "dark" },
        revision: "1",
        txid: "tx-location",
      })
    })
    while (!output.includes('"txid":"tx-location"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output.match(/"value":"dark"/g)).toHaveLength(1)
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
    const modelKey = JSON.stringify(["provider-1", "model-1"])
    online.replace("models", location, [{ key: modelKey, row: { id: "model-1", providerID: "provider-1" } }])
    while (
      !output.includes('"id":"build"') ||
      !output.includes('"value":"dark"') ||
      !output.includes('"key":["provider-1","model-1"]')
    )
      output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain(`"scopeKey":${JSON.stringify(location)}`)
    expect(output).not.toContain(`"key":${JSON.stringify(modelKey)}`)
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

  test("clears cursor scopes for locations deleted before reconnect", async () => {
    database = createTestDatabase().database
    const online = createOnlineRequestStore()
    const location = JSON.stringify({ directory: "/deleted" })
    database.collections.write({
      collection: "locations",
      scopeKey: "",
      rowKey: location,
      row: { directory: "/deleted" },
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
    database.collections.delete("locations", "", location)
    const cursor = { feedId: database.feed.get().feedId, seq: database.changes.current() }
    const app = createApp({ database, online })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = (await created.json()) as { streamId: string }
    await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        lists: true,
        sessions: [],
        cursors: { [`settings:${location}`]: cursor, [`agents:${location}`]: cursor },
      }),
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while ((output.match(/event: snapshot.end/g)?.length ?? 0) < 10)
      output += decoder.decode((await reader.read()).value)

    expect(output).not.toContain('"value":"stale"')
    expect(output).not.toContain('"id":"stale-agent"')
    expect(output).toContain('"keyCount":0')

    output = ""
    database.collections.write({
      collection: "locations",
      scopeKey: "",
      rowKey: location,
      row: { directory: "/deleted" },
      revision: "2",
    })
    while (!output.includes('"collection":"settings"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(output).toContain('"collection":"settings"')
    expect(output).toContain(`"scopeKey":${JSON.stringify(location)}`)
  })

  test("does not clear current catalogs while replaying an old location deletion", async () => {
    database = createTestDatabase().database
    const online = createOnlineRequestStore()
    const location = JSON.stringify({ directory: "/restored" })
    database.collections.write({
      collection: "locations",
      scopeKey: "",
      rowKey: location,
      row: { directory: "/restored" },
      revision: "1",
    })
    const cursor = { feedId: database.feed.get().feedId, seq: database.changes.current() }
    database.collections.delete("locations", "", location)
    database.collections.write({
      collection: "locations",
      scopeKey: "",
      rowKey: location,
      row: { directory: "/restored" },
      revision: "2",
    })
    online.replace("agents", location, [{ key: "current", row: { id: "current-agent" } }])
    const app = createApp({ database, online })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = (await created.json()) as { streamId: string }
    await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: true, sessions: [], cursors: { "locations:": cursor } }),
    })
    const response = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while (!output.includes('"op":"insert"')) output += decoder.decode((await reader.read()).value)
    await reader.cancel()

    expect(online.snapshot("agents", location).rows).toMatchObject([{ key: "current", row: { id: "current-agent" } }])
  })
})

async function createSubscribedStream(
  app: ReturnType<typeof createApp>,
  cursors: Record<string, { feedId: string; seq: number }> = {},
  sessions = ["session-1"],
  lists = false,
) {
  const created = await app.request("/api/collection/streams", { method: "POST" })
  const stream = (await created.json()) as { streamId: string }
  await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, lists, sessions, cursors }),
  })
  return stream
}
