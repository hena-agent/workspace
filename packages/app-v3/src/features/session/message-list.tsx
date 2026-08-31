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

export function MessageList({
  messages,
  working,
  ready,
}: {
  messages: SessionMessage[]
  working?: boolean
  ready: boolean
}) {
  const visibleMessages = ready ? messages : messages.filter((message) => message.pending)
  const visibleWorking = working && (ready || visibleMessages.length > 0)
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent aria-label="Messages" aria-busy={working || !ready} className="gap-0 py-2">
            {ready && visibleMessages.length === 0 && !visibleWorking ? (
              <ConversationEmptyState title="No messages yet" description="Say something to get started." />
            ) : (
              <>
                {visibleMessages.map((message, index) => (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                    <MessageRow message={message} working={visibleWorking && index === visibleMessages.length - 1} />
                  </MessageScrollerItem>
                ))}
                {showsThinking(visibleMessages, visibleWorking) ? (
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
