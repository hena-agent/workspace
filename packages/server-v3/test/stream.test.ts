import { describe, expect, test } from "bun:test"
import { StreamRevisionConflict, createStreamRegistry } from "../src/stream/registry"

describe("stream registry", () => {
  test("accepts only increasing subscription revisions", () => {
    const streams = createStreamRegistry({ graceMs: 1_000 })
    const stream = streams.create("local")
    const subscription = { revision: 1, lists: true, sessions: [], cursors: {} }

    expect(streams.subscribe("local", stream.id, subscription)).toEqual(subscription)
    expect(() => streams.subscribe("local", stream.id, subscription)).toThrow(StreamRevisionConflict)
  })

  test("does not expose streams across principals", () => {
    const streams = createStreamRegistry({ graceMs: 1_000 })
    const stream = streams.create("one")

    expect(streams.get("two", stream.id)).toBeUndefined()
  })

  test("expires detached resources after the grace period", () => {
    let time = 0
    const streams = createStreamRegistry({ graceMs: 100, now: () => time })
    const stream = streams.create("local")
    streams.attach("local", stream.id)
    time = 1_000
    expect(streams.get("local", stream.id)).toBeDefined()
    streams.detach("local", stream.id)
    time += 101
    expect(streams.get("local", stream.id)).toBeUndefined()
  })
})
