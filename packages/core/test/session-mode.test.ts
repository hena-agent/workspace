import { describe, expect, test } from "bun:test"
import { SessionMode } from "@hena/core/session/mode"

describe("SessionMode.system", () => {
  test("replaces the coding prompt in general chat mode", () => {
    const system = SessionMode.system("general-chat", ["coding prompt"])

    expect(system).toEqual([SessionMode.GENERAL_CHAT_SYSTEM])
    expect(system.join("\n")).not.toContain("coding prompt")
  })

  test("keeps the coding prompt in default mode", () => {
    expect(SessionMode.system(undefined, ["coding prompt"])).toEqual(["coding prompt"])
  })
})

describe("SessionMode.toolNames", () => {
  test("limits general chat to conversation and research tools", () => {
    expect(SessionMode.toolNames("general-chat")).toEqual(
      new Set(["attach_folder", "question", "webfetch", "websearch"]),
    )
  })

  test("does not limit coding mode tools", () => {
    expect(SessionMode.toolNames(undefined)).toBeUndefined()
  })
})
