import { useState } from "react"
import { Composer } from "@/features/session/composer/composer"
import type { Agent, Model, Project } from "@/lib/types"

export function NewSessionView({
  project,
  agents,
  models,
  onStart,
}: {
  project: Project
  agents: Agent[]
  models: Model[]
  onStart: (params: { text: string; agentId: string; modelId: string }) => void
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "")
  const [modelId, setModelId] = useState(models[0]?.id ?? "")

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
          agentId={agentId}
          modelId={modelId}
          onChangeAgent={setAgentId}
          onChangeModel={setModelId}
          onSend={(text) => onStart({ text, agentId, modelId })}
          placeholder="What are we doing today?"
        />
      </div>
    </div>
  )
}
