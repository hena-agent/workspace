import type { UserMessage } from "@/lib/types"
import { Attachment, AttachmentInfo, AttachmentPreview, Attachments } from "@/components/ai-elements/attachments"
import { Message, MessageContent } from "@/components/ai-elements/message"

export function UserMessageRow({ message }: { message: UserMessage }) {
  return (
    <Message from="user" data-role="user" data-pending={message.pending || undefined} className="max-w-none px-4 py-3 md:px-5">
      <p className="ml-auto text-xs font-medium text-muted-foreground">You{message.pending ? " · Sending" : ""}</p>
      <MessageContent>
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.files?.length ? <Attachments variant="inline">
          {message.files.map((file) => (
            <Attachment key={file} data={{ id: file, type: "file", filename: file, mediaType: "application/octet-stream", url: "" }}>
              <AttachmentPreview />
              <AttachmentInfo />
            </Attachment>
          ))}
        </Attachments> : null}
      </MessageContent>
    </Message>
  )
}
