import { describe, expect, test } from "bun:test"
import { GeneralChat } from "@hena/core/session/general-chat"

describe("GeneralChat", () => {
  test("derives its ceiling from the canonical safe actions", () => {
    expect(GeneralChat.SAFE_ACTIONS).toEqual(["question", "webfetch", "websearch"])
    expect(GeneralChat.CEILING).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "question", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "websearch", resource: "*", effect: "allow" },
    ])
  })
})
