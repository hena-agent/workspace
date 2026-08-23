import { describe, expect, test } from "bun:test"
import { pages } from "../src/stream/pages"

describe("stream pages", () => {
  test("limits a frame to 500 operations", () => {
    const output = pages(Array.from({ length: 501 }, (_, id) => ({ id })))

    expect(output.map((page) => page.length)).toEqual([500, 1])
  })

  test("splits frames by their decoded byte size", () => {
    const output = pages([{ text: "x".repeat(600 * 1024) }, { text: "y".repeat(600 * 1024) }])

    expect(output).toHaveLength(2)
  })
})
