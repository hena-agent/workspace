import { describe, expect, test } from "bun:test"
import { createAttachFolderController } from "./session-attach-folder"

describe("createAttachFolderController", () => {
  test("keeps replies bound to the source and retries only the reply after attaching", async () => {
    const source = { directory: "/source" }
    const attached: string[] = []
    const replied: string[] = []
    let attempts = 0
    let submitted = 0
    const controller = createAttachFolderController({
      source,
      attach: async (folder) => {
        attached.push(folder)
      },
      reply: async (sdk) => {
        replied.push(sdk.directory)
        attempts += 1
        if (attempts === 1) throw new Error("reply failed")
      },
      onSubmit: () => {
        submitted += 1
      },
    })

    await expect(controller.submit("/attached")).rejects.toThrow("reply failed")
    expect(controller.committed()).toBe(true)

    await controller.submit()

    expect(attached).toEqual(["/attached"])
    expect(replied).toEqual(["/source", "/source"])
    expect(submitted).toBe(1)
  })

  test("does not commit when attaching fails", async () => {
    const controller = createAttachFolderController({
      source: undefined,
      attach: async () => {
        throw new Error("attach failed")
      },
      reply: async () => {},
      onSubmit: () => {},
    })

    await expect(controller.submit("/attached")).rejects.toThrow("attach failed")
    expect(controller.committed()).toBe(false)
    await expect(controller.submit()).rejects.toThrow("Folder is required")
  })
})
