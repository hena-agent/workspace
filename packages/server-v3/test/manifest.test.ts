import { describe, expect, test } from "bun:test"
import { requestedScopes } from "../src/collection/manifest"

describe("collection manifest", () => {
  test("expands location and session scoped collections", () => {
    const scopes = requestedScopes(
      { lists: true, sessions: ["ses_1"] },
      ['{"directory":"/repo"}'],
    )

    expect(scopes).toContainEqual({ collection: "providers", scopeKey: '{"directory":"/repo"}' })
    expect(scopes).toContainEqual({ collection: "messages", scopeKey: "ses_1" })
    expect(scopes).toContainEqual({ collection: "projects", scopeKey: "" })
  })
})
