import { describe, expect, test } from "bun:test"
import { formatRelativeTime } from "./time"

const now = new Date("2026-08-10T18:00:00.000Z").getTime()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe("formatRelativeTime", () => {
  test("shows seconds for very recent timestamps", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now")
  })

  test("shows minutes", () => {
    expect(formatRelativeTime(now - 5 * MIN, now)).toBe("5m ago")
  })

  test("shows hours", () => {
    expect(formatRelativeTime(now - 3 * HOUR, now)).toBe("3h ago")
  })

  test("shows days", () => {
    expect(formatRelativeTime(now - 2 * DAY, now)).toBe("2d ago")
  })

  test("falls back to a short date beyond a week", () => {
    expect(formatRelativeTime(now - 30 * DAY, now)).toMatch(/\d/)
  })
})
