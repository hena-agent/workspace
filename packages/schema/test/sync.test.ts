import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Sync } from "../src/sync"

describe("Sync.canonicalJson", () => {
  test("matches JSON semantics for undefined container values", () => {
    expect(Sync.canonicalJson({ keep: 1, omit: undefined, values: [1, undefined, 2] })).toBe(
      '{"keep":1,"values":[1,null,2]}',
    )
    expect(() => Sync.canonicalJson(undefined)).toThrow(TypeError)
  })

  test("sorts object keys independently of the machine locale", () => {
    expect(Sync.canonicalJson({ "ä": 1, z: 2 })).toBe('{"z":2,"ä":1}')
  })
})

describe("Sync idempotency keys", () => {
  test("accepts UUIDs and rejects arbitrary or oversized keys", () => {
    expect(
      Schema.decodeUnknownSync(Sync.CancelInput)({
        idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
        expectedRevision: 0,
      }).idempotencyKey,
    ).toBe("123e4567-e89b-42d3-a456-426614174000")
    expect(() =>
      Schema.decodeUnknownSync(Sync.CancelInput)({ idempotencyKey: "arbitrary", expectedRevision: 0 }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Sync.CancelInput)({ idempotencyKey: "x".repeat(1024 * 1024), expectedRevision: 0 }),
    ).toThrow()
  })
})

describe("Sync filesystem queries", () => {
  test("decodes bounded limits and cross-platform absolute paths", () => {
    expect(
      Schema.decodeUnknownSync(Sync.FileFindQuery)({ directory: "C:\\repo", query: "src", limit: "1000" }),
    ).toMatchObject({ directory: "C:\\repo", limit: 1000 })
    expect(() =>
      Schema.decodeUnknownSync(Sync.FileFindQuery)({ directory: "/repo", query: "src", limit: "0" }),
    ).toThrow()
  })

  test("rejects traversal in list paths", () => {
    expect(() => Schema.decodeUnknownSync(Sync.FileListQuery)({ directory: "/repo", path: "../secret" })).toThrow()
  })

  test("rejects invalid workspace IDs", () => {
    expect(() => Schema.decodeUnknownSync(Sync.FileListQuery)({ directory: "/repo", workspaceID: "invalid" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Sync.FileFindQuery)({ directory: "/repo", workspaceID: "invalid", query: "src" }),
    ).toThrow()
  })
})
