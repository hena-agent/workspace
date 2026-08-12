import type { SessionMessage } from "@/lib/types"
import { MessageRow } from "./messages/message-row"

export function MessageList({ messages }: { messages: SessionMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <p>No messages yet. Say something to get started.</p>
      </div>
    )
  }

  return (
    <div role="log" aria-label="Messages" className="flex flex-col py-2">
      {messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}
    </div>
  )
}
