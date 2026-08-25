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

function sse(frames: Record<string, unknown>[]) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")))
      controller.close()
    },
  }), { headers: { "content-type": "text/event-stream" } })
}
