import type { QuestionAnswer, QuestionRequest } from "@hena/sdk/v2"

export function sessionAttachFolderAction(request: Pick<QuestionRequest, "action">) {
  if (request.action?.type !== "attach-folder") return
  return request.action
}

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

export async function rejectFolderAttachment(input: { reject: () => Promise<unknown>; onSubmit: () => void }) {
  await input.reject()
  input.onSubmit()
}
