import { useState } from "react"
import { Composer } from "@/features/session/composer/composer"
import type { Agent, Model, ModelRef, Provider } from "@/lib/types"
import type { DraftBody } from "@/local-state/drafts"
import { resolveModel } from "@/lib/model"
import { resolveAgent } from "@/lib/agent"

export function NewSessionView({
  serverUrl,
  project,
  agents,
  models,
  providers,
  onStart,
  defaultAgentId,
  defaultModel,
  defaultDelivery,
  draft,
  onDraftChange,
  onFindFiles,
}: {
  serverUrl?: string
  project: { name: string; path: string }
  agents: Agent[]
  models: Model[]
  providers: Provider[]
  onStart: (params: { text: string; files?: { uri: string; name?: string }[]; agentId: string; model: ModelRef | undefined; delivery: "send" | "queue" }) => unknown
  defaultAgentId?: string
  defaultModel?: ModelRef
  defaultDelivery?: "steer" | "queue"
  draft?: DraftBody
  onDraftChange?: (draft: DraftBody) => void
  onFindFiles?: (query: string, signal: AbortSignal) => Promise<string[]>
}) {
  const [agentId, setAgentId] = useState(draft?.agentID ?? "")
  // Uncontrolled: both routes that render this view set remountDeps to the route params, so a
  // new draftId always remounts this component and re-reads `draft` once; there is no in-place
  // prop change to miss.
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- see comment above
  const [model, setModel] = useState(draft?.model)
  const selectedAgentId = resolveAgent(agents, agentId, defaultAgentId)?.id ?? ""
  const selection = model ?? draft?.model ?? draft?.modelID ?? defaultModel ?? models[0]
  const selectedModel = resolveModel(models, selection)
  const selectedDelivery = draft?.delivery ?? defaultDelivery ?? "steer"

  function start(text: string, files: { uri: string; name?: string }[] | undefined, delivery: "send" | "queue") {
    if (!selectedAgentId) return Promise.reject(new Error("Select an agent before sending."))
    if (selection && !selectedModel) {
      return Promise.reject(new Error("Select a model before sending. The saved model is unavailable or matches multiple providers."))
    }
    return onStart({ text, ...(files?.length ? { files } : {}), agentId: selectedAgentId, model: selectedModel, delivery })
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-lg font-semibold">New session</h1>
        <p className="text-sm text-muted-foreground">
          {project.name} · {project.path}
        </p>
      </div>
      <div className="w-full">
        <Composer
          serverUrl={serverUrl}
          agents={agents}
          models={models}
          providers={providers}
          agentId={selectedAgentId}
          model={selectedModel}
          onChangeAgent={setAgentId}
          onChangeModel={setModel}
          onSend={(text, files) => start(text, files, selectedDelivery === "queue" ? "queue" : "send")}
          onQueue={(text, files) => start(text, files, "queue")}
          initialText={draft?.text}
          initialSelection={draft?.selection}
          initialError={draft?.error}
          droppedAttachments={draft?.droppedAttachments}
          onFindFiles={onFindFiles}
          onDraftChange={(value) => onDraftChange?.({
            ...value,
            agentID: selectedAgentId || agentId || undefined,
            model: model ?? draft?.model ?? selectedModel,
            modelID: draft?.modelID,
            delivery: selectedDelivery,
          })}
          placeholder="What are we doing today?"
        />
      </div>
    </div>
  )
}
