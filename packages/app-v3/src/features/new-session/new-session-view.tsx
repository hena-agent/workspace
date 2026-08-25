import { useState } from "react"
import { Composer } from "@/features/session/composer/composer"
import type { Agent, Model, Project } from "@/lib/types"
import type { DraftBody } from "@/local-state/drafts"

export function NewSessionView({
  project,
  agents,
  models,
  onStart,
  defaultAgentId,
  defaultModelId,
  defaultDelivery,
  draft,
  onDraftChange,
  onFindFiles,
}: {
  project: Project
  agents: Agent[]
  models: Model[]
  onStart: (params: { text: string; files?: { uri: string; name?: string }[]; agentId: string; modelId: string; delivery: "send" | "queue" }) => unknown
  defaultAgentId?: string
  defaultModelId?: string
  defaultDelivery?: "steer" | "queue"
  draft?: DraftBody
  onDraftChange?: (draft: DraftBody) => void
  onFindFiles?: (query: string, signal: AbortSignal) => Promise<string[]>
}) {
  const [agentId, setAgentId] = useState(draft?.agentID ?? "")
  const [modelId, setModelId] = useState(draft?.modelID ?? "")
  const selectedAgentId = agentId || defaultAgentId || agents[0]?.id || ""
  const selectedModelId = modelId || defaultModelId || models[0]?.id || ""
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
          agentId={selectedAgentId}
          modelId={selectedModelId}
          onChangeAgent={setAgentId}
          onChangeModel={setModelId}
          onSend={(text, files) => onStart({ text, ...(files?.length ? { files } : {}), agentId: selectedAgentId, modelId: selectedModelId, delivery: selectedDelivery === "queue" ? "queue" : "send" })}
          onQueue={(text, files) => onStart({ text, ...(files?.length ? { files } : {}), agentId: selectedAgentId, modelId: selectedModelId, delivery: "queue" })}
          initialText={draft?.text}
          initialSelection={draft?.selection}
          initialError={draft?.error}
          droppedAttachments={draft?.droppedAttachments}
          onFindFiles={onFindFiles}
          onDraftChange={(value) => onDraftChange?.({
            ...value,
            agentID: selectedAgentId || undefined,
            modelID: selectedModelId || undefined,
            delivery: selectedDelivery,
          })}
          placeholder="What are we doing today?"
        />
      </div>
    </div>
  )
}
