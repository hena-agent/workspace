import { Button } from "@hena/ui/button"
import { DockTray } from "@hena/ui/dock-surface"
import { Icon } from "@hena/ui/icon"
import { createMemo, onCleanup, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import type { DirectorySDK } from "@/context/sdk"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useTabs } from "@/context/tabs"
import { showToast } from "@/utils/toast"
import { createAttachFolderController, runSharedAttachment } from "./session-attach-folder"
import { ScopedKey } from "@/utils/server-scope"
import { pathKey } from "@/utils/path-key"
import type { BrowserQuestionRequest } from "@/context/question"
import { locationHeaders } from "@/context/question"

type PendingAttachment = {
  source: DirectorySDK
  attaching?: Promise<void>
  committed: boolean
  dispose: Array<() => void>
  notify: Set<(state: { sending: boolean; retry: boolean }) => void>
}
const pending = new Map<string, PendingAttachment>()

export const SessionAttachFolderDock: Component<{ request: BrowserQuestionRequest; onSubmit: () => void }> = (
  props,
) => {
  const serverSDK = useServerSDK()
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const layout = useLayout()
  const pickDirectory = useDirectoryPicker()
  const sourceServerSDK = serverSDK()
  const sourceSDK = sourceServerSDK.ensureDirSdkContext(props.request.location.directory)
  const cacheKey = ScopedKey.from(sourceServerSDK.scope, `${props.request.protocol}:${props.request.id}`)
  const existing = pending.get(cacheKey)
  const attachment = existing ?? { source: sourceSDK, committed: false, dispose: [], notify: new Set() }
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
        if (event.type === "session.deleted" || event.type === "session.updated") {
          const info = (event.properties as { info?: { id?: string; time?: { archived?: number } } } | undefined)?.info
          if (info?.id === props.request.sessionID && (event.type === "session.deleted" || info.time?.archived))
            clearPending()
          return
        }
        if (
          event.type !== "question.replied" &&
          event.type !== "question.rejected" &&
          event.type !== "question.v2.replied" &&
          event.type !== "question.v2.rejected"
        )
          return
        if ((event.properties as { requestID?: string } | undefined)?.requestID === props.request.id) clearPending()
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
      const result = await context.projects.attachFolder(current.projectID, folder, props.request.sessionID)
      const server = ServerConnection.key(sourceServerSDK.server)
      await tabs.replaceDirectory(server, result.previous, result.directory)
      const selection = layout.home.selection()
      if (
        selection.server === server &&
        selection.directory &&
        pathKey(selection.directory) === pathKey(result.previous)
      )
        layout.home.setSelection({ server, directory: result.directory })
    },
    reply: (source, answers) =>
      props.request.protocol === "legacy"
        ? source.client.question.reply({ requestID: props.request.id, answers })
        : sourceServerSDK.current.questions.reply(
            { sessionID: props.request.sessionID, requestID: props.request.id, answers },
            { headers: locationHeaders(props.request.location) },
          ),
    onSubmit: () => {
      clearPending()
      props.onSubmit()
    },
  })
  const [state, setState] = createStore({
    picking: false,
    sending: !!attachment.attaching,
    retry: controller.committed(),
  })
  const update = (next: { sending: boolean; retry: boolean }) => setState(next)
  attachment.notify.add(update)
  onCleanup(() => {
    attachment.notify.delete(update)
    if (!attachment.attaching && !attachment.committed) clearPending()
  })

  const reject = async () => {
    if (state.sending || controller.committed()) return
    setState("sending", true)
    await (
      props.request.protocol === "legacy"
        ? sourceSDK.client.question.reject({ requestID: props.request.id })
        : sourceServerSDK.current.questions.reject(
            { sessionID: props.request.sessionID, requestID: props.request.id },
            { headers: locationHeaders(props.request.location) },
          )
    )
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
    if (state.sending || attachment.attaching) return
    setState("sending", true)
    const task = runSharedAttachment(attachment, () =>
      controller.submit(folder).catch((error: unknown) => {
        fail(error)
      }),
    )
    attachment.notify.forEach((notify) => notify({ sending: true, retry: controller.committed() }))
    void task.finally(() => {
      attachment.notify.forEach((notify) => notify({ sending: false, retry: controller.committed() }))
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
