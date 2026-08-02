import type { QuestionAnswer } from "@hena/sdk/v2"

type AttachFolderControllerInput<T> = {
  source: T
  attach: (folder: string) => Promise<unknown>
  reply: (source: T, answers: QuestionAnswer[]) => Promise<unknown>
  onSubmit: () => void
  committed?: boolean | (() => boolean)
  onCommit?: () => void
}

type AttachFolderController = {
  committed: () => boolean
  submit: (folder?: string) => Promise<void>
}

export function createAttachFolderController<T>(input: AttachFolderControllerInput<T>): AttachFolderController {
  let committed = typeof input.committed === "boolean" ? input.committed : false
  const isCommitted = () => (typeof input.committed === "function" ? input.committed() : committed)
  return {
    committed: isCommitted,
    async submit(folder?: string) {
      if (!isCommitted()) {
        if (!folder) throw new Error("Folder is required")
        await input.attach(folder)
        committed = true
        input.onCommit?.()
      }
      await input.reply(input.source, [])
      input.onSubmit()
    },
  }
}
