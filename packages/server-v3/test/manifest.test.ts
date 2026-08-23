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
    expect(scopes).toContainEqual({ collection: "settings", scopeKey: "profile" })
    expect(scopes).toContainEqual({ collection: "settings", scopeKey: '{"directory":"/repo"}' })
    expect(scopes).not.toContainEqual({ collection: "settings", scopeKey: "" })
  })

  test("deduplicates repeated session IDs", () => {
    const scopes = requestedScopes({ lists: false, sessions: ["ses_1", "ses_1"] })

    expect(scopes.filter((scope) => scope.collection === "messages" && scope.scopeKey === "ses_1")).toHaveLength(1)
  })
})
