import { describe, expect, test } from "bun:test"
import { GeneralChat } from "@hena/core/session/general-chat"

describe("GeneralChat.system", () => {
  test("replaces the coding prompt when active", () => {
    const system = GeneralChat.system(true, ["coding prompt"])

    expect(system).toEqual([GeneralChat.GENERAL_CHAT_SYSTEM])
    expect(system.join("\n")).not.toContain("coding prompt")
  })

  test("keeps the coding prompt when inactive", () => {
    expect(GeneralChat.system(false, ["coding prompt"])).toEqual(["coding prompt"])
  })
})

describe("GeneralChat.permissions", () => {
  test("applies a capability ceiling when active", () => {
    expect(GeneralChat.permissions(true)).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "question", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "websearch", resource: "*", effect: "allow" },
    ])
  })

  test("keeps configured permissions when inactive", () => {
    const configured = [{ action: "bash", resource: "*", effect: "allow" as const }]
    expect(GeneralChat.permissions(false, configured)).toBe(configured)
  })
})
