import { useLayoutEffect, useRef } from "react"
import type { SessionMessage } from "@/lib/types"
import { MessageRow } from "./messages/message-row"

export function MessageList({ messages }: { messages: SessionMessage[] }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const followsLatestRef = useRef(true)

  useLayoutEffect(() => {
    if (!followsLatestRef.current || !viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [messages])

  return (
    <div
      ref={viewportRef}
      role="log"
      aria-label="Messages"
      aria-relevant="additions text"
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        const viewport = event.currentTarget
        followsLatestRef.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48
      }}
    >
      {messages.length === 0 ? (
        <div className="flex min-h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
          <p>No messages yet. Say something to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col py-2">
          {messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  )
}
