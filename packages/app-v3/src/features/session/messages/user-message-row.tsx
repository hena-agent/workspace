import type { UserMessage } from "@/lib/types"

export function UserMessageRow({ message }: { message: UserMessage }) {
  return (
    <div data-role="user" data-pending={message.pending || undefined} className="flex flex-col gap-1 px-4 py-3 md:px-5">
      <div className="text-xs font-medium text-muted-foreground">You{message.pending ? " · Sending" : ""}</div>
      <p className="text-sm whitespace-pre-wrap">{message.text}</p>
    </div>
  )
}
