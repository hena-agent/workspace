import { useDeferredValue, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
  const [modelOpen, setModelOpen] = useState(false)
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const selectedModel = models.find((model) => model.id === modelId)
  const filteredModels = modelOpen
    ? models.filter((model) => matchesModelSearch(deferredSearch, [model.name, model.id, model.providerId]))
    : []

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Select value={agentId} onValueChange={onChangeAgent}>
        <SelectTrigger size="sm" aria-label="Agent" className="h-7 max-w-24 shrink-0 hit-area border-none px-2 text-xs shadow-none">
          <SelectValue placeholder="Agent" />
        </SelectTrigger>
        <SelectContent>
          {agents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>
              {agent.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Model"
        aria-haspopup="dialog"
        aria-expanded={modelOpen}
        className="h-7 min-w-0 flex-1 hit-area justify-between px-2 text-xs font-normal shadow-none"
        onClick={() => setModelOpen(true)}
      >
        <span className="truncate">{selectedModel?.name ?? "Model"}</span>
        <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
      </Button>
      {modelOpen ? (
        <CommandDialog
          open
          onOpenChange={(open) => {
            setModelOpen(open)
            if (!open) setSearch("")
          }}
          title="Select model"
          description="Search connected models by name, ID, or provider."
        >
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch} placeholder="Search models…" autoFocus />
            <CommandList>
              <CommandEmpty>No models found.</CommandEmpty>
              {filteredModels.map((model) => (
                <CommandItem
                  key={`${model.providerId}/${model.id}`}
                  value={`${model.providerId}/${model.id}`}
                  data-checked={model.id === modelId}
                  onSelect={() => {
                    onChangeModel(model.id)
                    setModelOpen(false)
                    setSearch("")
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  <span className="text-xs text-muted-foreground">{model.providerId}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </CommandDialog>
      ) : null}
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
