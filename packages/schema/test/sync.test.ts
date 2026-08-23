import { describe, expect, test } from "bun:test"
import { Sync } from "../src/sync"

describe("Sync.canonicalJson", () => {
  test("matches JSON semantics for undefined container values", () => {
    expect(Sync.canonicalJson({ keep: 1, omit: undefined, values: [1, undefined, 2] })).toBe(
      '{"keep":1,"values":[1,null,2]}',
    )
    expect(() => Sync.canonicalJson(undefined)).toThrow(TypeError)
  })
})
