import { describe, expect, test } from "bun:test"
import { createDeltaHub } from "../src/stream/delta"

describe("delta hub", () => {
  test("uses UTF-8 byte offsets and isolates sessions", () => {
    const hub = createDeltaHub()
    const first: unknown[] = []
    const second: unknown[] = []
    hub.subscribe("session-1", (delta) => first.push(delta))
    hub.subscribe("session-2", (delta) => second.push(delta))

    hub.publish({ sessionId: "session-1", messageId: "message-1", partId: "part-1", partKind: "text", text: "😀" })
    hub.publish({ sessionId: "session-1", messageId: "message-1", partId: "part-1", partKind: "text", text: "a" })

    expect(first).toEqual([
      { sessionId: "session-1", messageId: "message-1", partId: "part-1", partKind: "text", offset: 0, text: "😀" },
      { sessionId: "session-1", messageId: "message-1", partId: "part-1", partKind: "text", offset: 4, text: "a" },
    ])
    expect(second).toEqual([])
  })

  test("clears offsets when a part finalizes", () => {
    const hub = createDeltaHub()
    const output: Array<{ offset: number }> = []
    hub.subscribe("session-1", (delta) => output.push(delta))
    const identity = { sessionId: "session-1", messageId: "message-1", partId: "part-1", partKind: "text" as const }

    hub.publish({ ...identity, text: "old" })
    hub.finalize(identity)
    hub.publish({ ...identity, text: "new" })

    expect(output.at(-1)?.offset).toBe(0)
  })
})
