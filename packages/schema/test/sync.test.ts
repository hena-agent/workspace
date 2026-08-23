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
