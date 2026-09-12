import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("Identifier wire compatibility", () => {
  test("keeps the six-byte timestamp and fourteen-character random suffix", () => {
    const first = Identifier.create("msg", "ascending", 1788869100077)
    const second = Identifier.create("msg", "ascending", 1788869100078)
    expect(first).toMatch(/^msg_080e8422d001[0-9A-Za-z]{14}$/)
    expect(second).toMatch(/^msg_080e8422e001[0-9A-Za-z]{14}$/)
    expect(first < second).toBe(true)
  })

  test("retains the six-byte descending format", () => {
    expect(Identifier.create("ses", "descending", 1788869100077)).toMatch(/^ses_f7f17bdd2ffe[0-9A-Za-z]{14}$/)
  })

  test("decodes only the timestamp field, not the random suffix", () => {
    expect(Identifier.timestamp("msg_080e8422d001ZZZZZZZZZZZZZZ")).toBe(0x080e8422d)
  })
})
