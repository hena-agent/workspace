import { describe, expect, test } from "bun:test"
import { GeneralChat as CoreGeneralChat } from "@hena/core/session/general-chat"
import { Permission } from "@/permission"
import { GeneralChat } from "@/session/general-chat"

describe("GeneralChat", () => {
  test("derives the V1 ceiling from Core safe actions", () => {
    expect(GeneralChat.CEILING.slice(1).map((rule) => rule.permission)).toEqual([...CoreGeneralChat.SAFE_ACTIONS])
  })

  test("maps attach_folder catalog visibility to question permission", () => {
    expect(
      Permission.visibleTools(
        { attach_folder: true, shell: true },
        [{ permission: "question", pattern: "*", action: "allow" }, ...GeneralChat.CEILING],
      ),
    ).toEqual({ attach_folder: true })
  })
})
