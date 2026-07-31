import type { QuestionRequest } from "@hena/sdk/v2"
import { Button } from "@hena/ui/button"
import { DockTray } from "@hena/ui/dock-surface"
import { Icon } from "@hena/ui/icon"
import { createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useTabs } from "@/context/tabs"
import { showToast } from "@/utils/toast"
import {
  createAttachFolderController,
  rejectFolderAttachment,
  sessionAttachFolderAction,
} from "./session-attach-folder"

export const SessionAttachFolderDock: Component<{ request: QuestionRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const layout = useLayout()
  const pickDirectory = useDirectoryPicker()
  const [state, setState] = createStore({ picking: false, sending: false, retry: false })
  const action = createMemo(() => sessionAttachFolderAction(props.request))
  const serverContext = () => global.ensureServerCtx(serverSDK().server)
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

  const controller = createAttachFolderController({
    attach: async (folder) => {
      const current = action()
      if (!current) throw new Error("Attach-folder action is missing")
      const context = serverContext()
      const result = await context.projects.attachFolder(current.projectID, folder)
      const server = ServerConnection.key(serverSDK().server)
      await tabs.replaceDirectory(server, result.previous, result.directory)
      const selection = layout.home.selection()
      if (selection.server === server && selection.directory === result.previous)
        layout.home.setSelection({ server, directory: result.directory })
    },
    reply: (answers) => sdk().client.question.reply({ requestID: props.request.id, answers }),
    onSubmit: props.onSubmit,
  })

  const reject = async () => {
    if (state.sending || controller.committed()) return
    setState("sending", true)
    await rejectFolderAttachment({
      onSubmit: props.onSubmit,
      reject: () => sdk().client.question.reject({ requestID: props.request.id }),
    }).catch((error) => {
      setState("sending", false)
      fail(error)
    })
  }

  const attach = (folder?: string) => {
    if (state.sending) return
    setState("sending", true)
    void controller.submit(folder).catch((error) => {
      setState("sending", false)
      setState("retry", controller.committed())
      fail(error)
    })
  }

  const choose = () => {
    if (state.picking || state.sending) return
    if (state.retry) {
      attach()
      return
    }
    const current = action()
    if (!current) return
    setState("picking", true)
    pickDirectory({
      server: serverSDK().server,
      title: language.t("home.project.attachFolder"),
      description: `${current.reason} ${language.t("dialog.project.attach.description", {
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
          <div class="line-clamp-2 text-12-regular text-text-weak">{action()?.reason}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="normal"
            disabled={state.picking || state.sending || state.retry}
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
