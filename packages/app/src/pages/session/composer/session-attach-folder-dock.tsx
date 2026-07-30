import type { QuestionRequest } from "@hena/sdk/v2"
import { Button } from "@hena/ui/button"
import { DockTray } from "@hena/ui/dock-surface"
import { Icon } from "@hena/ui/icon"
import { createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"

export const SessionAttachFolderDock: Component<{ request: QuestionRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const global = useGlobal()
  const language = useLanguage()
  const pickDirectory = useDirectoryPicker()
  const [state, setState] = createStore({ picking: false, sending: false })
  const action = () => props.request.action!
  const serverContext = () => global.ensureServerCtx(serverSDK().server)
  const project = createMemo(() =>
    serverContext()
      .projects.managed.list()
      .find((item) => item.id === action().projectID),
  )

  const fail = (error: unknown) => {
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  }

  const reply = async (answer: "Folder attached" | "Cancelled") => {
    if (state.sending) return
    setState("sending", true)
    props.onSubmit()
    await sdk()
      .client.question.reply({ requestID: props.request.id, answers: [[answer]] })
      .catch((error) => {
        setState("sending", false)
        fail(error)
      })
  }

  const attach = (folder: string) => {
    if (state.sending) return
    setState("sending", true)
    const previous = sdk().directory
    const questionClient = sdk().client.question
    const context = serverContext()
    void context.sdk.client.v2.project
      .attachFolder({ projectID: action().projectID, folder })
      .then(async (response) => {
        if (!response.data) throw response.error
        context.projects.managed.set(response.data)
        await context.sync.session.resolve(props.request.sessionID, { force: true })
        context.projects.replace(previous, response.data.worktree)
        await context.queryClient.invalidateQueries({ queryKey: context.sync.homeSessions.indexKey })
        props.onSubmit()
        await questionClient.reply({ requestID: props.request.id, answers: [["Folder attached"]] })
      })
      .catch((error) => {
        setState("sending", false)
        fail(error)
      })
  }

  const choose = () => {
    if (state.picking || state.sending) return
    setState("picking", true)
    pickDirectory({
      server: serverSDK().server,
      title: language.t("home.project.attachFolder"),
      description: `${action().reason} ${language.t("dialog.project.attach.description", {
        project: project()?.name ?? action().projectID,
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
          <div class="line-clamp-2 text-12-regular text-text-weak">{action().reason}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="normal"
            disabled={state.picking || state.sending}
            onClick={() => void reply("Cancelled")}
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
