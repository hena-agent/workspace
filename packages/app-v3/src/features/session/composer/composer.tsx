import { useState } from "react"
import { ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import type { Agent, Model } from "@/lib/types"
import { AgentModelPicker } from "./agent-model-picker"
import { shouldSendOnEnter } from "./should-send-on-enter"

export function Composer({
  agents,
  models,
  agentId,
  modelId,
  onChangeAgent,
  onChangeModel,
  onSend,
  disabled,
  placeholder = "Message the agent…",
}: {
  agents: Agent[]
  models: Model[]
  agentId: string
  modelId: string
  onChangeAgent: (id: string) => void
  onChangeModel: (id: string) => void
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [text, setText] = useState("")
  const hasFinePointer = useMediaQuery("(any-pointer: fine)")

  function send() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText("")
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <Textarea
        aria-label="Message"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (shouldSendOnEnter(event, hasFinePointer)) {
            event.preventDefault()
            send()
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-16 resize-none border-none shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2">
        <AgentModelPicker
          agents={agents}
          models={models}
          agentId={agentId}
          modelId={modelId}
          onChangeAgent={onChangeAgent}
          onChangeModel={onChangeModel}
        />
        <Button
          size="icon"
          aria-label="Send message"
          disabled={disabled || text.trim().length === 0}
          onClick={send}
          className="hit-area"
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}
