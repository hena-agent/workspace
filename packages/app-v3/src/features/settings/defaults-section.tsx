import { useState } from "react"
import { MutationError } from "@/mutations/lifecycle"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Agent, Model } from "@/lib/types"
import { SettingsRow } from "./settings-row"

export function DefaultsSection({
  agents,
  models,
  defaultAgent,
  defaultModel,
  queueDelivery,
  onChange,
}: {
  agents: Agent[]
  models: Model[]
  defaultAgent?: string
  defaultModel?: string
  queueDelivery?: "steer" | "queue"
  onChange?: (key: "defaultAgent" | "defaultModel" | "queueDelivery", value: string) => Promise<void>
}) {
  const [states, setStates] = useState<Record<string, "clean" | "dirty" | "saving" | "saved" | "conflicted">>({})
  const [attempts, setAttempts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()

  function change(key: "defaultAgent" | "defaultModel" | "queueDelivery", value: string) {
    if (!onChange) return
    setAttempts((current) => ({ ...current, [key]: value }))
    setStates((current) => ({ ...current, [key]: "saving" }))
    setError(undefined)
    void onChange(key, value).then(() => {
      setStates((current) => ({ ...current, [key]: "saved" }))
      setAttempts((current) => Object.fromEntries(Object.entries(current).filter(([attempt]) => attempt !== key)))
    }).catch((cause) => {
      setStates((current) => ({ ...current, [key]: cause instanceof MutationError && cause.code === "revision_conflict" ? "conflicted" : "dirty" }))
      setError(cause instanceof Error ? cause.message : "Could not save setting")
    })
  }

  return (
    <div className="divide-y">
      <SettingsRow label="Default agent" description="Used when a session has not selected an agent.">
        <Select value={attempts.defaultAgent ?? defaultAgent} onValueChange={(value) => change("defaultAgent", value)} disabled={!onChange || states.defaultAgent === "saving"}>
          <SelectTrigger size="sm" aria-label="Default agent" className="w-44"><SelectValue placeholder="Select agent" /></SelectTrigger>
          <SelectContent>{agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}</SelectContent>
        </Select>
        <FieldState state={states.defaultAgent} authoritative={defaultAgent} />
      </SettingsRow>
      <SettingsRow label="Default model" description="Used when a session has not selected a model.">
        <Select value={attempts.defaultModel ?? defaultModel} onValueChange={(value) => change("defaultModel", value)} disabled={!onChange || states.defaultModel === "saving"}>
          <SelectTrigger size="sm" aria-label="Default model" className="w-44"><SelectValue placeholder="Select model" /></SelectTrigger>
          <SelectContent>{models.map((model) => <SelectItem key={`${model.providerId}:${model.id}`} value={`${model.providerId}:${model.id}`}>{model.name}</SelectItem>)}</SelectContent>
        </Select>
        <FieldState state={states.defaultModel} authoritative={defaultModel} />
      </SettingsRow>
      <SettingsRow label="Prompt delivery" description="Steer active work or queue prompts until the session is idle.">
        <Select value={attempts.queueDelivery ?? queueDelivery ?? "steer"} onValueChange={(value) => change("queueDelivery", value)} disabled={!onChange || states.queueDelivery === "saving"}>
          <SelectTrigger size="sm" aria-label="Prompt delivery" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="steer">Steer</SelectItem><SelectItem value="queue">Queue</SelectItem></SelectContent>
        </Select>
        <FieldState state={states.queueDelivery} authoritative={queueDelivery} />
      </SettingsRow>
      {error ? <p role="alert" className="py-2 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

function FieldState({ state = "clean", authoritative }: { state?: "clean" | "dirty" | "saving" | "saved" | "conflicted"; authoritative?: string }) {
  if (state === "clean") return null
  return <span role="status" className="text-xs text-muted-foreground">
    {state === "conflicted" ? `Conflicted. Server value: ${authoritative ?? "unset"}` : state[0]!.toUpperCase() + state.slice(1)}
  </span>
}
