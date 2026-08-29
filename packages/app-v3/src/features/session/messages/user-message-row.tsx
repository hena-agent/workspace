import { Paperclip } from "lucide-react"
import type { UserMessage } from "@/lib/types"
import { Message, MessageContent } from "@/components/ai-elements/message"

export function UserMessageRow({ message }: { message: UserMessage }) {
  return (
    <Message from="user" data-role="user" data-pending={message.pending || undefined} className="max-w-none px-4 py-3 md:px-5">
      <p className="ml-auto text-xs font-medium text-muted-foreground">You{message.pending ? " · Sending" : ""}</p>
      <MessageContent>
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.files?.length ? <div className="flex flex-wrap gap-2">
          {message.files.map((file) => (
            <span key={file} className="flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-sm font-medium">
              <Paperclip aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{file}</span>
            </span>
          ))}
        </div> : null}
      </MessageContent>
    </Message>
  )
}
