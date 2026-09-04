import { useState } from "react"
import { Composer } from "@/features/session/composer/composer"
import type { Agent, Model, ModelRef, Provider } from "@/lib/types"
import type { DraftBody } from "@/local-state/drafts"

export function NewSessionView({
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
  project: { name: string; path: string }
  agents: Agent[]
  models: Model[]
  providers?: Provider[]
  onStart: (params: { text: string; files?: { uri: string; name?: string }[]; agentId: string; model: ModelRef | undefined; delivery: "send" | "queue" }) => unknown
  defaultAgentId?: string
  defaultModel?: ModelRef
  defaultDelivery?: "steer" | "queue"
  draft?: DraftBody
  onDraftChange?: (draft: DraftBody) => void
  onFindFiles?: (query: string, signal: AbortSignal) => Promise<string[]>
}) {
  const [agentId, setAgentId] = useState(draft?.agentID ?? "")
  const [model, setModel] = useState<ModelRef | undefined>(draft?.model)
  const selectedAgentId = agentId || defaultAgentId || agents[0]?.id || ""
  const selectedModel = model ?? defaultModel ?? models[0]
  const selectedDelivery = draft?.delivery ?? defaultDelivery ?? "steer"

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
          agents={agents}
          models={models}
          providers={providers}
          agentId={selectedAgentId}
          model={selectedModel}
          onChangeAgent={setAgentId}
          onChangeModel={setModel}
          onSend={(text, files) => onStart({ text, ...(files?.length ? { files } : {}), agentId: selectedAgentId, model: selectedModel, delivery: selectedDelivery === "queue" ? "queue" : "send" })}
          onQueue={(text, files) => onStart({ text, ...(files?.length ? { files } : {}), agentId: selectedAgentId, model: selectedModel, delivery: "queue" })}
          initialText={draft?.text}
          initialSelection={draft?.selection}
          initialError={draft?.error}
          droppedAttachments={draft?.droppedAttachments}
          onFindFiles={onFindFiles}
          onDraftChange={(value) => onDraftChange?.({
            ...value,
            agentID: selectedAgentId || undefined,
            model: selectedModel,
            delivery: selectedDelivery,
          })}
          placeholder="What are we doing today?"
        />
      </div>
    </div>
  )
}
