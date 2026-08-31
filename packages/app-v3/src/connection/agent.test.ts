import { describe, expect, test } from "bun:test"
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

  test("prefetches sessions in one restart and reuses them when claimed", async () => {
    const firstSubscription = Promise.withResolvers<void>()
    const subscriptions: unknown[] = []
    const sessionIds = Array.from({ length: 12 }, (_, index) => `session-${index + 1}`)
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
    agent.prefetch(sessionIds)
    firstSubscription.resolve()
    await waitUntil(() => subscriptions.length === 2)
    agent.claim("session-1")
    await Bun.sleep(20)
    agent.dispose()
    await started

    expect(subscriptions).toEqual([
      expect.objectContaining({ sessions: [] }),
      expect.objectContaining({ sessions: sessionIds }),
    ])
  })

  test("reports when transcript collections are ready", async () => {
    const agent = createConnectionAgent("http://hena.test")

    agent.store.applySnapshot("sessionInputs", "session-1", [], 0)
    agent.store.applySnapshot("todos", "session-1", [], 0)
    agent.store.applySnapshot("messages", "session-1", [], 0)
    await Bun.sleep(0)
    expect(agent.isSessionReady("session-1")).toBe(false)

    agent.store.applySnapshot("parts", "session-1", [], 0)
    await Bun.sleep(0)
    expect(agent.isSessionReady("session-1")).toBe(true)
    agent.dispose()
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
    agent.prefetch(["session-1"])
    await waitUntil(() => agent.store.isReady("projects") || agent.status === "error")
    expect(agent.store.isReady("projects")).toBe(true)
    expect(agent.status).toBe("live")
    agent.dispose()
    await started
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

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error("Timed out waiting for connection state")
}
