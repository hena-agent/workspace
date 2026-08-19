import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("id.timestamp", () => {
  test("round-trips the current time exactly", () => {
    const now = Date.now()
    const id = Identifier.create("tool", "ascending", now)
    expect(Identifier.timestamp(id)).toBe(now)
  })

  test("round-trips far-future timestamps without overflow", () => {
    // 6 bytes (48 bits) overflows for any real date past ~1972 once shifted
    // left 12 bits for the counter; this pins the fix at a date centuries out.
    const future = new Date("2500-01-01T00:00:00.000Z").getTime()
    const id = Identifier.create("tool", "ascending", future)
    expect(Identifier.timestamp(id)).toBe(future)
  })

  test("preserves relative ordering across a multi-day span", () => {
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const old = Identifier.timestamp(Identifier.create("tool", "ascending", now - 10 * dayMs))
    const cutoff = Identifier.timestamp(Identifier.create("tool", "ascending", now - 7 * dayMs))
    const recent = Identifier.timestamp(Identifier.create("tool", "ascending", now - 3 * dayMs))

    expect(old).toBeLessThan(cutoff)
    expect(recent).toBeGreaterThanOrEqual(cutoff)
  })
})
