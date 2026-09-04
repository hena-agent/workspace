import { useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import {
  PromptInputButton,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { SelectGroup } from "@/components/ui/select"
import type { Agent, Model, ModelRef, Provider } from "@/lib/types"

export function AgentModelPicker({
  agents,
  models,
  providers = [],
  agentId,
  model,
  onChangeAgent,
  onChangeModel,
  disabled,
}: {
  agents: Agent[]
  models: Model[]
  providers?: Provider[]
  agentId: string
  model: ModelRef | undefined
  onChangeAgent: (id: string) => void
  onChangeModel: (model: ModelRef) => void
  disabled?: boolean
}) {
  const [modelOpen, setModelOpen] = useState(false)
  const selectedModel = models.find((item) => item.id === model?.id && item.providerId === model?.providerId)
  const groups = groupByProvider(models, providers)

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
      <Dialog open={modelOpen} onOpenChange={setModelOpen}>
        <DialogTrigger asChild>
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
        </DialogTrigger>
        <DialogContent aria-describedby={undefined} className="outline! border-none! p-0 outline-border! outline-solid!">
          <DialogTitle className="sr-only">Select model</DialogTitle>
          <Command
            className="**:data-[slot=command-input-wrapper]:h-auto"
            filter={scoreModel}
            defaultValue={model ? itemValue(model) : undefined}
          >
            <CommandInput className="h-auto py-3.5" placeholder="Search models…" autoFocus />
            <CommandList>
              <CommandEmpty>No models found.</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.providerId} heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={itemValue(item)}
                      value={itemValue(item)}
                      keywords={[item.name, item.id, item.providerId, group.heading]}
                      data-checked={item.id === model?.id && item.providerId === model?.providerId}
                      onSelect={() => {
                        onChangeModel({ id: item.id, providerId: item.providerId })
                        setModelOpen(false)
                      }}
                    >
                      <span className="flex-1 truncate text-left">{item.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function itemValue(model: ModelRef) {
  return `${model.providerId}/${model.id}`
}

function groupByProvider(models: Model[], providers: Provider[]) {
  const byProvider = new Map<string, Model[]>()
  for (const model of models) {
    const items = byProvider.get(model.providerId)
    if (items) items.push(model)
    else byProvider.set(model.providerId, [model])
  }
  return [...byProvider].map(([providerId, items]) => ({
    providerId,
    heading: providers.find((provider) => provider.id === providerId)?.name ?? providerId,
    items,
  }))
}

// cmdk's default fuzzy scorer matches loose subsequences, so a query like "open ai" also
// scores an unrelated model like "anthropic/claude-sonnet-5". Rank normalized substrings
// instead: prefix match, then substring, then a compact (whitespace-stripped) substring so
// "gpt52" still finds "GPT-5.2".
function scoreModel(value: string, search: string, keywords: string[] = []) {
  const query = normalize(search)
  if (!query) return 1
  const compactQuery = query.replaceAll(" ", "")
  return Math.max(
    0,
    ...[value, ...keywords].map((candidate) => {
      const normalized = normalize(candidate)
      if (!normalized) return 0
      if (normalized.startsWith(query)) return 1
      if (normalized.includes(query)) return 0.8
      return normalized.replaceAll(" ", "").includes(compactQuery) ? 0.6 : 0
    }),
  )
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
}
