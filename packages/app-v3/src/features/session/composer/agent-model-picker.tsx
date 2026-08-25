import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Agent, Model } from "@/lib/types"

export function AgentModelPicker({
  agents,
  models,
  agentId,
  modelId,
  onChangeAgent,
  onChangeModel,
}: {
  agents: Agent[]
  models: Model[]
  agentId: string
  modelId: string
  onChangeAgent: (id: string) => void
  onChangeModel: (id: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Select value={agentId} onValueChange={onChangeAgent}>
        <SelectTrigger size="sm" aria-label="Agent" className="h-7 max-w-24 shrink-0 hit-area border-none px-2 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {agents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>
              {agent.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={modelId} onValueChange={onChangeModel}>
        <SelectTrigger size="sm" aria-label="Model" className="h-7 min-w-0 flex-1 hit-area border-none px-2 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
