import { useId, useRef, useState } from "react"
import { ChevronsUpDown, SlidersHorizontal } from "lucide-react"
import {
  PromptInputButton,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SelectGroup } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Agent, Model, ModelRef, Provider } from "@/lib/types"
import { modelKey, resolveModel } from "@/lib/model"
import { useModelVisibility } from "@/local-state/model-visibility"

export function AgentModelPicker({
  agents,
  models,
  providers,
  agentId,
  model,
  onChangeAgent,
  onChangeModel,
  disabled,
  serverUrl,
}: {
  agents: Agent[]
  models: Model[]
  providers: Provider[]
  agentId: string
  model: ModelRef | undefined
  onChangeAgent: (id: string) => void
  onChangeModel: (model: ModelRef) => void
  disabled?: boolean
  serverUrl?: string
}) {
  const [open, setOpen] = useState<"select" | "manage">()
  const trigger = useRef<HTMLButtonElement>(null)
  const visibility = useModelVisibility(serverUrl)
  const selectedModel = resolveModel(models, model)
  const groups = open === "select" ? groupByProvider(models.filter(visibility.visible), providers) : []

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
      <Popover open={open === "select"} onOpenChange={(next) => setOpen(next ? "select" : undefined)}>
        <PopoverTrigger asChild>
          <PromptInputButton
            ref={trigger}
            aria-label="Model"
            aria-haspopup="dialog"
            aria-expanded={open === "select"}
            disabled={disabled}
            className="min-w-0 flex-1 hit-area justify-between px-2 text-xs font-normal"
          >
            <span className="truncate">{selectedModel?.name ?? "Model"}</span>
            <ChevronsUpDown className="shrink-0 opacity-50" />
          </PromptInputButton>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Select model"
          side="top"
          align="start"
          className="max-h-(--radix-popover-content-available-height) w-80 max-w-(--radix-popover-content-available-width) overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            if (open === "manage") event.preventDefault()
          }}
        >
          {/* Unmount immediately so reopening during the exit animation resets search. */}
          {open === "select" ? (
            <Command
              className="min-h-0"
              label="Search models"
              filter={scoreModel}
              defaultValue={selectedModel && visibility.visible(selectedModel) ? modelKey(selectedModel) : undefined}
            >
              <div className="flex shrink-0 items-center gap-1 pr-1 [&_[data-slot=command-input-wrapper]]:min-w-0 [&_[data-slot=command-input-wrapper]]:flex-1">
                <CommandInput placeholder="Search models…" autoFocus />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Manage Models"
                      disabled={!serverUrl}
                      onClick={() => setOpen("manage")}
                      onKeyDown={(event) => {
                        // cmdk otherwise treats Enter on this button as model selection.
                        if (event.key === "Enter") event.stopPropagation()
                      }}
                    >
                      <SlidersHorizontal />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Manage Models</TooltipContent>
                </Tooltip>
              </div>
              <CommandList className="min-h-0 scroll-pt-8">
                <CommandEmpty>No models found.</CommandEmpty>
                {groups.map((group) => (
                  <CommandGroup
                    key={group.providerId}
                    value={group.providerId}
                    heading={group.heading}
                    className="overflow-visible [&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-10 [&_[cmdk-group-heading]]:bg-popover"
                  >
                    {group.items.map((item) => (
                      <CommandItem
                        key={modelKey(item)}
                        value={modelKey(item)}
                        keywords={[item.name, item.id, item.providerId, group.heading]}
                        data-checked={item === selectedModel}
                        onSelect={() => {
                          onChangeModel({ id: item.id, providerId: item.providerId })
                          setOpen(undefined)
                        }}
                      >
                        <span className="flex-1 truncate text-left">{item.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          ) : null}
        </PopoverContent>
      </Popover>
      <Dialog open={open === "manage"} onOpenChange={(next) => setOpen(next ? "manage" : undefined)}>
        <DialogContent
          className="flex max-h-[min(36rem,calc(100dvh-2rem))] flex-col sm:max-w-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>Manage Models</DialogTitle>
            <DialogDescription>Choose which models appear in the model selector.</DialogDescription>
          </DialogHeader>
          {open === "manage" ? (
            <ManageModelsContent models={models} providers={providers} visibility={visibility} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ManageModelsContent({
  models,
  providers,
  visibility,
}: {
  models: Model[]
  providers: Provider[]
  visibility: ReturnType<typeof useModelVisibility>
}) {
  const id = useId()
  const [search, setSearch] = useState("")
  const groups = groupByProvider(models, providers).flatMap((group) => {
    const matches = group.items.filter(
      (item) => scoreModel(modelKey(item), search, [item.name, item.id, item.providerId, group.heading]) > 0,
    )
    return matches.length ? [{ ...group, matches }] : []
  })

  return (
    <>
      <Input
        type="search"
        aria-label="Search models"
        placeholder="Search models…"
        autoFocus
        className="shrink-0"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="min-h-0 scroll-pt-12 overflow-y-auto" aria-label="Model visibility">
        {groups.length === 0 ? (
          <Empty role="status">
            <EmptyHeader>
              <EmptyDescription>No models found.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {groups.map((group) => (
          <section key={group.providerId} aria-label={group.heading}>
            <Field orientation="horizontal" className="sticky top-0 z-10 bg-popover px-1 py-3">
              <FieldLabel htmlFor={`${id}-provider-${encodeURIComponent(group.providerId)}`}>
                {group.heading}
              </FieldLabel>
              <Switch
                id={`${id}-provider-${encodeURIComponent(group.providerId)}`}
                aria-label={`All ${group.heading} models`}
                checked={group.items.every(visibility.visible)}
                onCheckedChange={(checked) => visibility.setVisibility(group.items, checked)}
              />
            </Field>
            <FieldGroup className="gap-0 px-1">
              {group.matches.map((item) => (
                <Field key={modelKey(item)} orientation="horizontal" className="py-3">
                  <FieldLabel htmlFor={`${id}-${encodeURIComponent(modelKey(item))}`}>{item.name}</FieldLabel>
                  <Switch
                    id={`${id}-${encodeURIComponent(modelKey(item))}`}
                    checked={visibility.visible(item)}
                    onCheckedChange={(checked) => visibility.setVisibility([item], checked)}
                  />
                </Field>
              ))}
            </FieldGroup>
          </section>
        ))}
      </div>
    </>
  )
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
