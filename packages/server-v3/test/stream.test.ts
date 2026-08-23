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

  test("supersedes the previous attachment generation", () => {
    const streams = createStreamRegistry({ graceMs: 1_000 })
    const stream = streams.create("local")
    const first = streams.attach("local", stream.id)!
    let disconnected = false
    expect(streams.bind("local", stream.id, first.generation, () => {
      disconnected = true
    })).toBe(true)

    const second = streams.attach("local", stream.id)!

    expect(disconnected).toBe(true)
    expect(second.generation).toBe(first.generation + 1)
    expect(streams.bind("local", stream.id, first.generation, () => {})).toBe(false)
  })

  test("disconnects an active attachment when deleting its resource", () => {
    const streams = createStreamRegistry({ graceMs: 1_000 })
    const stream = streams.create("local")
    const attached = streams.attach("local", stream.id)!
    let disconnected = false
    streams.bind("local", stream.id, attached.generation, () => {
      disconnected = true
    })

    expect(streams.delete("local", stream.id)).toBe(true)
    expect(disconnected).toBe(true)
    expect(streams.get("local", stream.id)).toBeUndefined()
  })

  test("disconnects an active attachment when its subscription changes", () => {
    const streams = createStreamRegistry({ graceMs: 1_000 })
    const stream = streams.create("local")
    streams.subscribe("local", stream.id, { revision: 1, lists: false, sessions: ["one"], cursors: {} })
    const attached = streams.attach("local", stream.id)!
    let disconnected = false
    streams.bind("local", stream.id, attached.generation, () => {
      disconnected = true
    })

    streams.subscribe("local", stream.id, { revision: 2, lists: false, sessions: ["two"], cursors: {} })

    expect(disconnected).toBe(true)
    expect(streams.get("local", stream.id)?.subscription?.sessions).toEqual(["two"])
  })
})
