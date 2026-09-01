import { describe, expect, test } from "bun:test"
import { Sync } from "@hena/schema/sync"
import { createConnectionAgent, parseEventStream } from "./agent"

describe("event stream parser", () => {
  test("parses chunked SSE records without losing multiline data", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: rows\ndata: {\"type\":\"ro"))
        controller.enqueue(encoder.encode("ws\"}\n\nevent: heartbeat\ndata: {\"time\":1}\n\n"))
        controller.close()
      },
    })
    const events = []
    for await (const event of parseEventStream(stream)) events.push(event)

    expect(events).toEqual([
      { event: "rows", data: "{\"type\":\"rows\"}" },
      { event: "heartbeat", data: "{\"time\":1}" },
    ])
  })
})

describe("connection protocol", () => {
  test("restarts when a session is claimed during subscription", async () => {
    const firstSubscription = Promise.withResolvers<void>()
    const subscriptions: unknown[] = []
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json())
        if (subscriptions.length === 1) await firstSubscription.promise
        return Response.json({ revision: subscriptions.length, generation: 0 })
      }
      return sse([])
    })

    const started = agent.start()
    await waitUntil(() => subscriptions.length === 1)
    agent.claim("session-1")
    firstSubscription.resolve()
    await waitUntil(() => subscriptions.length === 2)
    agent.dispose()
    await started

    expect(subscriptions).toEqual([
      expect.objectContaining({ sessions: [] }),
      expect.objectContaining({ sessions: ["session-1"] }),
    ])
  })

  test("retains the focused session and eight recent sessions", async () => {
    const subscriptions: { sessions?: string[] }[] = []
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json() as { sessions?: string[] })
        return Response.json({ revision: 1, generation: 0 })
      }
      return sse([])
    })

    Array.from({ length: 101 }, (_, index) => `session-${index + 1}`).forEach((sessionId) => agent.claim(sessionId))
    const started = agent.start()
    await waitUntil(() => subscriptions.length === 1)
    agent.dispose()
    await started

    expect(subscriptions[0]?.sessions).toEqual(
      Array.from({ length: 9 }, (_, index) => `session-${101 - index}`),
    )
  })

  test("backfills retained sessions when focus cleanup runs before the next claim", async () => {
    const subscriptions: { sessions?: string[] }[] = []
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json() as { sessions?: string[] })
        return Response.json({ revision: subscriptions.length, generation: 0 })
      }
      return sse([])
    })
    const release = Array.from({ length: 10 }).reduce<(() => void) | undefined>((previous, _, index) => {
      previous?.()
      return agent.claim(`session-${index + 1}`)
    }, undefined)
    release?.()
    agent.claim("session-9")

    const started = agent.start()
    await waitUntil(() => subscriptions.length === 1)
    expect(subscriptions[0]?.sessions).toHaveLength(9)
    expect(subscriptions[0]?.sessions?.[0]).toBe("session-9")
    agent.dispose()
    await started
  })

  test("keeps the stream when focus moves to a retained session", async () => {
    const subscriptions: unknown[] = []
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json())
        return Response.json({ revision: subscriptions.length, generation: 0 })
      }
      return sse([], request.signal)
    })
    agent.prefetch(["session-1", "session-2"])
    const started = agent.start()
    await waitUntil(() => subscriptions.length === 1)

    const release = agent.claim("session-1")
    release()
    agent.claim("session-2")
    await Bun.sleep(20)
    agent.dispose()
    await started

    expect(subscriptions).toHaveLength(1)
  })

  test("prefetches every session in the active project", async () => {
    const subscriptions: { sessions?: string[] }[] = []
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json() as { sessions?: string[] })
        return Response.json({ revision: 1, generation: 0 })
      }
      return sse([])
    })
    agent.prefetch(Array.from({ length: 9 }, (_, index) => `session-${index + 1}`))
    const started = agent.start()
    await waitUntil(() => subscriptions.length === 1)
    agent.dispose()
    await started

    expect(subscriptions[0]?.sessions).toEqual(Array.from({ length: 9 }, (_, index) => `session-${index + 1}`))
  })

  test("bounds a large project to the protocol subscription limit", async () => {
    const subscriptions: { sessions?: string[] }[] = []
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json() as { sessions?: string[] })
        return Response.json({ revision: 1, generation: 0 })
      }
      return sse([])
    })
    agent.claim("lingered")
    agent.claim("focused")
    agent.prefetch(Array.from({ length: 200 }, (_, index) => `project-${index}`))

    const started = agent.start()
    await waitUntil(() => subscriptions.length === 1)
    agent.dispose()
    await started

    const sessions = subscriptions[0]?.sessions ?? []
    expect(sessions).toHaveLength(Sync.MaxSubscribedSessions)
    expect(sessions.slice(0, 2)).toEqual(["focused", "lingered"])
    expect(sessions.at(-1)).toBe(`project-${Sync.MaxSubscribedSessions - 3}`)
  })

  test("drops inactive project transcripts outside the linger cache", () => {
    const agent = createConnectionAgent("http://hena.test")
    agent.store.applySnapshot("messages", "session-1", [{ key: "message-1", row: { id: "message-1" } }], 0)
    agent.store.applySnapshot("messages", "session-2", [{ key: "message-2", row: { id: "message-2" } }], 0)
    agent.prefetch(["session-1", "session-2"])

    agent.prefetch(["session-2"])

    expect(agent.store.rows("messages", "session-1")).toEqual([])
    expect(agent.store.rows("messages", "session-2")).toEqual([{ id: "message-2" }])
    agent.dispose()
  })

  test("notifies subscribers for status transitions instead of every frame", async () => {
    const common = { protocolVersion: 1, feedId: "feed", runtimeId: "runtime", streamId: "stream", generation: 1, subscriptionRevision: 1 }
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) return Response.json({ revision: 1, generation: 0 })
      return sse(Array.from({ length: 50 }, (_, index) => ({ ...common, type: "heartbeat", time: index + 1 })), request.signal)
    })

    let notifications = 0
    agent.subscribe(() => { notifications++ })
    const started = agent.start()
    await waitUntil(() => agent.status === "live")
    const afterLive = notifications
    await Bun.sleep(20)
    agent.dispose()
    await started

    expect(afterLive).toBeLessThan(5)
    expect(notifications).toBe(afterLive + 1)
    expect(agent.lastSyncAt).toBeGreaterThan(0)
  })

  test("discards an unfinished snapshot when restarting the stream", async () => {
    const common = { protocolVersion: 1, feedId: "feed", runtimeId: "runtime", streamId: "stream", generation: 1, subscriptionRevision: 1 }
    let attachments = 0
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) return Response.json({ revision: attachments + 1, generation: 0 })
      attachments++
      return sse([
        { ...common, type: "snapshot.begin", scope: { collection: "projects", scopeKey: "" }, snapshotId: `snapshot-${attachments}`, baseSeq: 0, replace: true },
        ...(attachments === 1 ? [] : [{ ...common, type: "snapshot.end", scope: { collection: "projects", scopeKey: "" }, snapshotId: `snapshot-${attachments}`, keyCount: 0, throughSeq: 0 }]),
      ], request.signal)
    })

    const started = agent.start()
    await waitUntil(() => agent.status === "live")
    agent.claim("session-1")
    await waitUntil(() => agent.store.isReady("projects") || agent.status === "error")
    expect(agent.store.isReady("projects")).toBe(true)
    expect(agent.status).toBe("live")
    agent.dispose()
    await started
  })

  test("restarts one-sided transcript replacement with both cursors dropped", async () => {
    const subscriptions: { cursors?: Record<string, unknown> }[] = []
    const replacement = controlledSse()
    let attachments = 0
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json() as { cursors?: Record<string, unknown> })
        return Response.json({ revision: subscriptions.length, generation: 0 })
      }
      attachments++
      if (attachments === 1) return sse([
        snapshotFrame("snapshot.begin", "messages", { snapshotId: "replacement", baseSeq: 1, replace: true }),
        snapshotFrame("snapshot.page", "messages", { snapshotId: "replacement", rows: [] }),
        snapshotFrame("snapshot.end", "messages", { snapshotId: "replacement", keyCount: 0, throughSeq: 1 }),
      ], request.signal)
      return replacement.response(request.signal)
    })
    agent.store.applySnapshot("messages", "session-1", [{ key: "old", row: { id: "old", text: "Old transcript" } }], 1)
    agent.store.applySnapshot("parts", "session-1", [], 1)

    const started = agent.start()
    await waitUntil(() => attachments === 2)

    expect(subscriptions[0]?.cursors).toEqual(expect.objectContaining({
      "messages:session-1": { feedId: "feed", seq: 1 },
      "parts:session-1": { feedId: "feed", seq: 1 },
    }))
    expect(subscriptions[1]?.cursors).not.toHaveProperty("messages:session-1")
    expect(subscriptions[1]?.cursors).not.toHaveProperty("parts:session-1")
    expect(agent.store.isReady("messages", "session-1")).toBe(true)
    expect(agent.store.isReady("parts", "session-1")).toBe(true)
    expect(agent.store.rows("messages", "session-1")).toEqual([{ id: "old", text: "Old transcript" }])

    replacement.send([
      snapshotFrame("snapshot.begin", "messages", { snapshotId: "messages", baseSeq: 2, replace: true }),
      snapshotFrame("snapshot.page", "messages", { snapshotId: "messages", rows: [{ key: "new", row: { id: "new", text: "New transcript" } }] }),
      snapshotFrame("snapshot.end", "messages", { snapshotId: "messages", keyCount: 1, throughSeq: 2 }),
      snapshotFrame("snapshot.begin", "sessionInputs", { snapshotId: "inputs", baseSeq: 2, replace: true }),
      rowsFrame(3, [
        { seq: 3, collection: "parts", scopeKey: "session-1", rowKey: ["new", "text", "part-1"], op: "insert", row: { id: "part-1", messageID: "new", type: "text", text: "First" } },
        { seq: 3, collection: "sessionInputs", scopeKey: "session-1", rowKey: "input-1", op: "insert", row: { id: "input-1" } },
      ]),
      rowsFrame(4, [
        { seq: 4, collection: "messages", scopeKey: "session-1", rowKey: "new", op: "update", row: { id: "new", text: "Updated transcript" } },
        { seq: 4, collection: "parts", scopeKey: "session-1", rowKey: ["new", "text", "part-2"], op: "insert", row: { id: "part-2", messageID: "new", type: "text", text: "Second" } },
      ]),
      snapshotFrame("snapshot.end", "sessionInputs", { snapshotId: "inputs", keyCount: 0, throughSeq: 2 }),
    ])
    await Bun.sleep(0)
    expect(agent.store.rows("messages", "session-1")).toEqual([{ id: "old", text: "Old transcript" }])
    expect(agent.store.rows("sessionInputs", "session-1")).toEqual([{ id: "input-1" }])

    replacement.send([
      snapshotFrame("snapshot.begin", "parts", { snapshotId: "parts", baseSeq: 2, replace: true }),
      snapshotFrame("snapshot.end", "parts", { snapshotId: "parts", keyCount: 0, throughSeq: 2 }),
    ])
    await waitUntil(() => agent.store.rows("messages", "session-1").some((row) => row.id === "new"))
    expect(agent.store.rows("messages", "session-1")).toEqual([{ id: "new", text: "Updated transcript" }])
    expect(agent.store.rows("parts", "session-1").map((row) => row.id)).toEqual(["part-1", "part-2"])
    agent.dispose()
    await started
  })

  test("restarts an isolated input replacement with transcript cursors dropped", async () => {
    const subscriptions: { cursors?: Record<string, unknown> }[] = []
    const replacement = controlledSse()
    let attachments = 0
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) {
        subscriptions.push(await request.json() as { cursors?: Record<string, unknown> })
        return Response.json({ revision: subscriptions.length, generation: 0 })
      }
      attachments++
      if (attachments === 1) return sse([
        snapshotFrame("snapshot.begin", "sessionInputs", { snapshotId: "inputs", baseSeq: 2, replace: true }),
        snapshotFrame("snapshot.end", "sessionInputs", { snapshotId: "inputs", keyCount: 0, throughSeq: 2 }),
      ], request.signal)
      return replacement.response(request.signal)
    })
    agent.store.applySnapshot("messages", "session-1", [{ key: "old", row: { id: "old", text: "Old transcript" } }], 1)
    agent.store.applySnapshot("parts", "session-1", [], 1)
    agent.store.applySnapshot("sessionInputs", "session-1", [{ key: "message-1", row: { id: "message-1" } }], 1)
    agent.localMessages.stage("session-1", "message-1", { id: "message-1", text: "Local prompt" })
    agent.localMessages.acknowledge("session-1", "message-1")

    const started = agent.start()
    await waitUntil(() => attachments === 2)

    expect(subscriptions[0]?.cursors).toEqual(expect.objectContaining({
      "messages:session-1": { feedId: "feed", seq: 1 },
      "parts:session-1": { feedId: "feed", seq: 1 },
      "sessionInputs:session-1": { feedId: "feed", seq: 1 },
    }))
    expect(subscriptions[1]?.cursors).not.toHaveProperty("messages:session-1")
    expect(subscriptions[1]?.cursors).not.toHaveProperty("parts:session-1")
    expect(subscriptions[1]?.cursors).not.toHaveProperty("sessionInputs:session-1")
    expect(agent.localMessages.rows("session-1")).toHaveLength(1)
    expect(agent.store.rows("messages", "session-1")).toEqual([{ id: "old", text: "Old transcript" }])
    agent.dispose()
    await started
  })

  test("flushes transcript rows after an additive snapshot", async () => {
    const stream = controlledSse()
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) return Response.json({ revision: 2, generation: 0 })
      return stream.response(request.signal)
    })
    agent.store.applySnapshot("messages", "session-1", [{ key: "message-1", row: { id: "message-1", text: "Old" } }], 1)
    agent.store.applySnapshot("parts", "session-1", [], 1)

    const started = agent.start()
    await stream.ready
    const settled = agent.store.awaitTxid("txid", 1_000)
    stream.send([
      snapshotFrame("snapshot.begin", "messages", { snapshotId: "messages", baseSeq: 1, replace: false }),
      rowsFrame(2, [
        { seq: 2, collection: "messages", scopeKey: "session-1", rowKey: "message-1", op: "update", row: { id: "message-1", text: "Updated" }, txid: "txid" },
        { seq: 2, collection: "parts", scopeKey: "session-1", rowKey: ["message-1", "text", "part-1"], op: "insert", row: { id: "part-1", messageID: "message-1", type: "text", text: "New" } },
      ]),
      snapshotFrame("snapshot.end", "messages", { snapshotId: "messages", keyCount: 0, throughSeq: 1 }),
    ])
    await settled

    expect(agent.store.rows("messages", "session-1")).toEqual([{ id: "message-1", text: "Updated" }])
    expect(agent.store.rows("parts", "session-1")).toEqual([{ id: "part-1", messageID: "message-1", type: "text", text: "New" }])
    agent.dispose()
    await started
  })

  test("does not carry local rows across agent recreation", () => {
    const first = createConnectionAgent("http://hena.test")
    first.localMessages.stage("session-1", "message-1", { id: "message-1" })
    first.dispose()

    const second = createConnectionAgent("http://hena.test")
    expect(second.localMessages.rows("session-1")).toEqual([])
    second.dispose()
  })

  test("refuses servers whose protocol range excludes version one", async () => {
    const agent = createConnectionAgent("http://hena.test", async () =>
      Response.json({ feedId: "feed", protocol: { min: 2, max: 3 }, auth: "none" }))
    await agent.start()
    expect(agent.status).toBe("upgrade-required")
  })

  test("refuses password-protected servers", async () => {
    const agent = createConnectionAgent("http://hena.test", async () =>
      Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "required" }))
    await agent.start()
    expect(agent.status).toBe("unauthorized")
  })

  test("terminates on a snapshot key-count mismatch", async () => {
    const common = { protocolVersion: 1, feedId: "feed", runtimeId: "runtime", streamId: "stream", generation: 1, subscriptionRevision: 1 }
    const frames = [
      { ...common, type: "snapshot.begin", scope: { collection: "projects", scopeKey: "" }, snapshotId: "snapshot", baseSeq: 0, replace: true },
      { ...common, type: "snapshot.end", scope: { collection: "projects", scopeKey: "" }, snapshotId: "snapshot", keyCount: 1, throughSeq: 0 },
    ]
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/capabilities")) return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
      if (request.url.endsWith("/streams")) return Response.json({ streamId: "stream", generation: 0, expiresAt: Date.now() + 1_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
      if (request.url.endsWith("/subscription")) return Response.json({ revision: 1, generation: 0 })
      return sse(frames)
    })
    await agent.start()
    expect(agent.status).toBe("error")
    expect(agent.store.isReady("projects")).toBe(false)
  })
})

function sse(frames: Record<string, unknown>[], signal?: AbortSignal) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")))
      if (!signal) return controller.close()
      signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true })
    },
  }), { headers: { "content-type": "text/event-stream" } })
}

function controlledSse() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const ready = Promise.withResolvers<void>()
  return {
    ready: ready.promise,
    response(signal: AbortSignal) {
      return new Response(new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
          ready.resolve()
          signal.addEventListener("abort", () => value.error(new DOMException("Aborted", "AbortError")), { once: true })
        },
      }), { headers: { "content-type": "text/event-stream" } })
    },
    send(frames: Record<string, unknown>[]) {
      controller.enqueue(encoder.encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")))
    },
  }
}

function snapshotFrame(type: string, collection: string, value: Record<string, unknown>) {
  return {
    protocolVersion: 1,
    feedId: "feed",
    runtimeId: "runtime",
    streamId: "stream",
    generation: 0,
    subscriptionRevision: 2,
    type,
    scope: { collection, scopeKey: "session-1" },
    ...value,
  }
}

function rowsFrame(throughSeq: number, changes: Record<string, unknown>[]) {
  return {
    protocolVersion: 1,
    feedId: "feed",
    runtimeId: "runtime",
    streamId: "stream",
    generation: 0,
    subscriptionRevision: 2,
    type: "rows",
    affectedScopes: changes.map((change) => ({ collection: change.collection, scopeKey: change.scopeKey })),
    fromSeq: throughSeq,
    throughSeq,
    changes,
  }
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error("Timed out waiting for connection state")
}
