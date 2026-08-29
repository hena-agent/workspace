import { useDeferredValue, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector"
import {
  PromptInputButton,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input"
import { SelectGroup } from "@/components/ui/select"
import type { Agent, Model } from "@/lib/types"

export function AgentModelPicker({
  agents,
  models,
  agentId,
  modelId,
  onChangeAgent,
  onChangeModel,
  disabled,
}: {
  agents: Agent[]
  models: Model[]
  agentId: string
  modelId: string
  onChangeAgent: (id: string) => void
  onChangeModel: (id: string) => void
  disabled?: boolean
}) {
  const [modelOpen, setModelOpen] = useState(false)
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const selectedModel = models.find((model) => model.id === modelId)
  const filteredModels = modelOpen
    ? models.filter((model) => matchesModelSearch(deferredSearch, [model.name, model.id, model.providerId]))
    : []

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <PromptInputSelect disabled={disabled} value={agentId} onValueChange={onChangeAgent}>
        <PromptInputSelectTrigger size="sm" aria-label="Agent" className="h-7 max-w-24 shrink-0 hit-area px-2 text-xs">
          <PromptInputSelectValue placeholder="Agent" />
        </PromptInputSelectTrigger>
        <PromptInputSelectContent>
          <SelectGroup>
            {agents.map((agent) => (
              <PromptInputSelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </PromptInputSelectItem>
            ))}
          </SelectGroup>
        </PromptInputSelectContent>
      </PromptInputSelect>
      <ModelSelector
        open={modelOpen}
        onOpenChange={(open) => {
          setModelOpen(open)
          if (!open) setSearch("")
        }}
      >
        <ModelSelectorTrigger asChild>
          <PromptInputButton
            aria-label="Model"
            aria-haspopup="dialog"
            aria-expanded={modelOpen}
            disabled={disabled}
            className="min-w-0 flex-1 hit-area justify-between px-2 text-xs font-normal"
          >
            <span className="truncate">{selectedModel?.name ?? "Model"}</span>
            <ChevronsUpDown className="shrink-0 opacity-50" />
          </PromptInputButton>
        </ModelSelectorTrigger>
        <ModelSelectorContent title="Select model">
          <ModelSelectorInput value={search} onValueChange={setSearch} placeholder="Search models…" autoFocus />
          <ModelSelectorList>
            <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
            <ModelSelectorGroup>
              {filteredModels.map((model) => (
                <ModelSelectorItem
                  key={`${model.providerId}/${model.id}`}
                  value={`${model.name} ${model.id} ${model.providerId}`}
                  forceMount
                  data-checked={model.id === modelId}
                  onSelect={() => {
                    onChangeModel(model.id)
                    setModelOpen(false)
                    setSearch("")
                  }}
                >
                  <ModelSelectorName>{model.name}</ModelSelectorName>
                  <span className="text-xs text-muted-foreground">{model.providerId}</span>
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>
    </div>
  )
}

function matchesModelSearch(query: string, values: string[]) {
  const search = normalizeModelSearch(query)
  if (!search) return true
  const compactSearch = search.replaceAll(" ", "")
  return values.some((value) => {
    const normalized = normalizeModelSearch(value)
    return normalized.includes(search) || normalized.replaceAll(" ", "").includes(compactSearch)
  })
}

function normalizeModelSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}
