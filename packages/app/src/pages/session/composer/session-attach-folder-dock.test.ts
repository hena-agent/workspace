import { describe, expect, test } from "bun:test"
import { createAttachFolderController, runSharedAttachment } from "./session-attach-folder"

describe("session attach folder controller", () => {
  test("closes only after attachment and the empty reply succeed", async () => {
    const calls: string[] = []

    const controller = createAttachFolderController({
      source: undefined,
      attach: async (folder) => void calls.push(`attach:${folder}`),
      onSubmit: () => void calls.push("close"),
      reply: async (_, answers) => void calls.push(`reply:${JSON.stringify(answers)}`),
    })
    await controller.submit("/folder")

    expect(calls).toEqual(["attach:/folder", "reply:[]", "close"])
  })

  test("keeps the dock open when attachment fails", async () => {
    const calls: string[] = []

    await expect(
      createAttachFolderController({
        source: undefined,
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
      source: undefined,
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

  test("shares an in-flight attachment across remounts", async () => {
    const state: { attaching?: Promise<void> } = {}
    let resolve!: () => void
    let puts = 0
    const submit = () => {
      puts++
      return new Promise<void>((done) => {
        resolve = done
      })
    }

    const first = runSharedAttachment(state, submit)
    const remounted = runSharedAttachment(state, submit)
    expect(remounted).toBe(first)
    expect(puts).toBe(1)
    resolve()
    await first
    expect(state.attaching).toBeUndefined()
  })
})
