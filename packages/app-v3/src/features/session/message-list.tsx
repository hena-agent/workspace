import { startTransition, useEffect, useState } from "react"
import type { SessionMessage } from "@/lib/types"
import { ConversationEmptyState } from "@/components/ai-elements/conversation"
import { Shimmer } from "@/components/ai-elements/shimmer"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { MessageRow } from "./messages/message-row"

// Mounting an entire transcript in one commit blocks the main thread in
// proportion to its length, so the oldest messages start hidden and are
// revealed through interruptible transitions. The hidden count only ever
// shrinks, so a live append can never unmount history that is already rendered.
const InitialMessages = 20
const MessageChunk = 40

export function MessageList({
  messages,
  working,
  ready,
}: {
  messages: SessionMessage[]
  working?: boolean
  ready: boolean
}) {
  const [hidden, setHidden] = useState(() => Math.max(0, messages.length - InitialMessages))
  useEffect(() => {
    if (hidden === 0) return
    startTransition(() => setHidden((current) => Math.max(0, current - MessageChunk)))
  }, [hidden])
  const visible = hidden > 0 ? messages.slice(hidden) : messages

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent aria-label="Messages" aria-busy={working || !ready} className="gap-0 py-2">
            {ready && messages.length === 0 && !working ? (
              <ConversationEmptyState title="No messages yet" description="Say something to get started." />
            ) : (
              <>
                {visible.map((message, index) => (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                    <MessageRow message={message} working={working && index === visible.length - 1} />
                  </MessageScrollerItem>
                ))}
                {showsThinking(visible, working) ? (
                  <MessageScrollerItem>
                    <Marker role="status" className="px-6 py-3 md:px-7">
                      <MarkerContent><Shimmer>Thinking...</Shimmer></MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                ) : null}
              </>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function showsThinking(messages: SessionMessage[], working?: boolean) {
  if (!working) return false
  const latest = messages.at(-1)
  return latest?.role !== "assistant" || latest.parts.length === 0
}
