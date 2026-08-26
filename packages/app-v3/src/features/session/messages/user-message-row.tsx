import type { UserMessage } from "@/lib/types"
import { Attachment, AttachmentContent, AttachmentGroup, AttachmentTitle } from "@/components/ui/attachment"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent, MessageHeader } from "@/components/ui/message"

export function UserMessageRow({ message }: { message: UserMessage }) {
  return (
    <Message align="end" data-role="user" data-pending={message.pending || undefined} className="px-4 py-3 md:px-5">
      <MessageContent>
        <MessageHeader>You{message.pending ? " · Sending" : ""}</MessageHeader>
        <Bubble variant="secondary" align="end">
          <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent>
        </Bubble>
        {message.files?.length ? <AttachmentGroup>
          {message.files.map((file) => (
            <Attachment key={file} size="xs">
              <AttachmentContent>
                <AttachmentTitle>{file}</AttachmentTitle>
              </AttachmentContent>
            </Attachment>
          ))}
        </AttachmentGroup> : null}
      </MessageContent>
    </Message>
  )
}
