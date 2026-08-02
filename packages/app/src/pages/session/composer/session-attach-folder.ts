import type { QuestionAnswer } from "@hena/sdk/v2"

export function createAttachFolderController(input: {
  attach: (folder: string) => Promise<unknown>
  reply: (answers: QuestionAnswer[]) => Promise<unknown>
  onSubmit: () => void
}) {
  let committed = false
  return {
    committed: () => committed,
    async submit(folder?: string) {
      if (!committed) {
        if (!folder) throw new Error("Folder is required")
        await input.attach(folder)
        committed = true
      }
      await input.reply([])
      input.onSubmit()
    },
  }
}
