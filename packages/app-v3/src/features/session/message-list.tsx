import type { SessionMessage } from "@/lib/types"
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

export function MessageList({ messages, working }: { messages: SessionMessage[]; working?: boolean }) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent aria-label="Messages" aria-busy={working} className="gap-0 py-2">
            {messages.length === 0 && !working ? (
              <div className="flex min-h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                <p>No messages yet. Say something to get started.</p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                    <MessageRow message={message} />
                  </MessageScrollerItem>
                ))}
                {showsThinking(messages, working) ? (
                  <MessageScrollerItem>
                    <Marker role="status" className="px-6 py-3 md:px-7">
                      <MarkerContent>Thinking...</MarkerContent>
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
