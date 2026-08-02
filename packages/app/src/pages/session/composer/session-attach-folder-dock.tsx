import type { QuestionRequest } from "@hena/sdk/v2"
import { Button } from "@hena/ui/button"
import { DockTray } from "@hena/ui/dock-surface"
import { Icon } from "@hena/ui/icon"
import { createMemo, onCleanup, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { type DirectorySDK, useSDK } from "@/context/sdk"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useTabs } from "@/context/tabs"
import { showToast } from "@/utils/toast"
import { createAttachFolderController } from "./session-attach-folder"
import { ScopedKey } from "@/utils/server-scope"
import { pathKey } from "@/utils/path-key"

type PendingAttachment = {
  source: DirectorySDK
  attaching: boolean
  committed: boolean
  dispose: Array<() => void>
}
const pending = new Map<string, PendingAttachment>()

export const SessionAttachFolderDock: Component<{ request: QuestionRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const layout = useLayout()
  const pickDirectory = useDirectoryPicker()
  const sourceSDK = sdk()
  const sourceServerSDK = serverSDK()
  const cacheKey = ScopedKey.from(sourceServerSDK.scope, props.request.id)
  const existing = pending.get(cacheKey)
  const attachment = existing ?? { source: sourceSDK, attaching: false, committed: false, dispose: [] }
  pending.set(cacheKey, attachment)
  const action = createMemo(() => (props.request.action?.type === "attach-folder" ? props.request.action : undefined))
  const reason = () => props.request.questions[0]?.question ?? ""
  const serverContext = () => global.ensureServerCtx(sourceServerSDK.server)
  const project = createMemo(() =>
    serverContext()
      .projects.chats()
      .find((item) => item.id === action()?.projectID),
  )

  const fail = (error: unknown) => {
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  }

  const clearPending = () => {
    attachment.dispose.splice(0).forEach((dispose) => dispose())
    pending.delete(cacheKey)
  }
  if (!existing) {
    attachment.dispose.push(
      sourceServerSDK.event.on(sourceSDK.directory, (event) => {
        if (event.type !== "question.replied" && event.type !== "question.rejected") return
        if (event.properties.requestID === props.request.id) clearPending()
      }),
      sourceServerSDK.event.on("global", (event) => {
        if (event.type === "global.disposed") clearPending()
      }),
    )
  }
  const controller = createAttachFolderController({
    source: attachment.source,
    committed: () => attachment.committed,
    onCommit: () => {
      attachment.committed = true
      pending.set(cacheKey, attachment)
    },
    attach: async (folder) => {
      const current = action()
      if (!current) throw new Error("Attach-folder action is missing")
      const context = serverContext()
      const result = await context.projects.attachFolder(current.projectID, folder)
      const server = ServerConnection.key(sourceServerSDK.server)
      await tabs.replaceDirectory(server, result.previous, result.directory)
      const selection = layout.home.selection()
      if (selection.server === server && selection.directory && pathKey(selection.directory) === pathKey(result.previous))
        layout.home.setSelection({ server, directory: result.directory })
    },
    reply: (source, answers) => source.client.question.reply({ requestID: props.request.id, answers }),
    onSubmit: () => {
      clearPending()
      props.onSubmit()
    },
  })
  const [state, setState] = createStore({ picking: false, sending: false, retry: controller.committed() })
  onCleanup(() => {
    if (!attachment.attaching && !attachment.committed) clearPending()
  })

  const reject = async () => {
    if (state.sending || controller.committed()) return
    setState("sending", true)
    await sourceSDK
      .client.question.reject({ requestID: props.request.id })
      .then(() => {
        clearPending()
        props.onSubmit()
      })
      .catch((error) => {
        setState("sending", false)
        fail(error)
      })
  }

  const attach = (folder?: string) => {
    if (state.sending) return
    setState("sending", true)
    attachment.attaching = true
    void controller
      .submit(folder)
      .catch((error) => {
        setState("sending", false)
        setState("retry", controller.committed())
        fail(error)
      })
      .finally(() => {
        attachment.attaching = false
        if (!attachment.committed) clearPending()
      })
  }

  const choose = () => {
    if (state.picking || state.sending) return
    if (controller.committed()) {
      attach()
      return
    }
    const current = action()
    if (!current) return
    setState("picking", true)
    pickDirectory({
      server: sourceServerSDK.server,
      title: language.t("home.project.attachFolder"),
      description: `${reason()} ${language.t("dialog.project.attach.description", {
        project: project()?.name ?? current.projectID,
      })} ${language.t("dialog.project.attach.warning")}`,
      actionLabel: language.t("home.project.attachFolder"),
      multiple: false,
      onSelect: (result) => {
        setState("picking", false)
        const folder = Array.isArray(result) ? result[0] : result
        if (folder) attach(folder)
      },
    })
  }

  return (
    <DockTray data-component="session-attach-folder-dock">
      <div class="flex min-h-16 items-center gap-3 px-4 py-3">
        <Icon name="folder-add-left" size="normal" class="shrink-0 text-text-weak" />
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-text-strong">{language.t("dialog.project.attach.title")}</div>
          <div class="line-clamp-2 text-12-regular text-text-weak">{reason()}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="normal"
            disabled={state.picking || state.sending || state.retry || controller.committed()}
            onClick={() => void reject()}
          >
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="normal" disabled={state.picking || state.sending} onClick={choose}>
            {state.sending ? language.t("common.loading") : language.t("home.project.attachFolder")}
          </Button>
        </div>
      </div>
    </DockTray>
  )
}
