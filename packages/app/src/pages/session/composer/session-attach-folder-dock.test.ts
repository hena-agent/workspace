import { describe, expect, test } from "bun:test"
import type { QuestionRequest } from "@hena/sdk/v2"
import {
  createAttachFolderController,
  rejectFolderAttachment,
  sessionAttachFolderAction,
} from "./session-attach-folder"

describe("session attach folder controller", () => {
  test("narrows only attach-folder actions", () => {
    expect(
      sessionAttachFolderAction({
        action: { type: "attach-folder", projectID: "project", reason: "Needs files" },
      }),
    ).toEqual({ type: "attach-folder", projectID: "project", reason: "Needs files" })
    expect(sessionAttachFolderAction({})).toBeUndefined()
    expect(
      sessionAttachFolderAction({ action: { type: "other" } as unknown as QuestionRequest["action"] }),
    ).toBeUndefined()
  })

  test("closes only after attachment and the empty reply succeed", async () => {
    const calls: string[] = []

    const controller = createAttachFolderController({
      attach: async (folder) => void calls.push(`attach:${folder}`),
      onSubmit: () => void calls.push("close"),
      reply: async (answers) => void calls.push(`reply:${JSON.stringify(answers)}`),
    })
    await controller.submit("/folder")

    expect(calls).toEqual(["attach:/folder", "reply:[]", "close"])
  })

  test("keeps the dock open when attachment fails", async () => {
    const calls: string[] = []

    await expect(
      createAttachFolderController({
        attach: async () => {
          throw new Error("failed")
        },
        onSubmit: () => void calls.push("close"),
        reply: async () => void calls.push("reply"),
      }).submit("/folder"),
    ).rejects.toThrow("failed")
    expect(calls).toEqual([])
  })

  test("retries only the pending reply after attachment commits", async () => {
    const calls: string[] = []
    let replies = 0
    const controller = createAttachFolderController({
      attach: async () => void calls.push("attach"),
      reply: async () => {
        calls.push("reply")
        if (replies++ === 0) throw new Error("reply failed")
      },
      onSubmit: () => void calls.push("close"),
    })

    await expect(controller.submit("/folder")).rejects.toThrow("reply failed")
    expect(controller.committed()).toBe(true)
    await controller.submit()

    expect(calls).toEqual(["attach", "reply", "reply", "close"])
  })

  test("closes cancellation and rejects the question without a sentinel answer", async () => {
    const calls: string[] = []

    await rejectFolderAttachment({
      onSubmit: () => void calls.push("close"),
      reject: async () => void calls.push("reject"),
    })

    expect(calls).toEqual(["reject", "close"])
  })

  test("keeps cancellation open when rejection fails", async () => {
    const calls: string[] = []
    await expect(
      rejectFolderAttachment({
        reject: async () => {
          calls.push("reject")
          throw new Error("failed")
        },
        onSubmit: () => void calls.push("close"),
      }),
    ).rejects.toThrow("failed")
    expect(calls).toEqual(["reject"])
  })
})
