import { useEffect, useRef, useState } from "react"
import type { FileUIPart } from "ai"
import { Paperclip } from "lucide-react"
import { Attachment, AttachmentInfo, AttachmentPreview, AttachmentRemove, Attachments } from "@/components/ai-elements/attachments"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputCommand,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import { DropdownMenuGroup } from "@/components/ui/dropdown-menu"
import { InputGroupTextarea } from "@/components/ui/input-group"
import { useMediaQuery } from "@/hooks/use-media-query"
import type { Agent, Model } from "@/lib/types"
import { AgentModelPicker } from "./agent-model-picker"
import { getComposerEnterAction } from "./should-send-on-enter"

type AttachedFile = { uri: string; name?: string }

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024
const ATTACHMENT_ERROR = "Each attachment must be 5 MiB or smaller and attachments must total 20 MiB or less."

type ComposerProps = {
  agents: Agent[]
  models: Model[]
  agentId: string
  modelId: string
  onChangeAgent: (id: string) => void
  onChangeModel: (id: string) => void
  onSend: (text: string, files?: { uri: string; name?: string }[]) => unknown
  onQueue: (text: string, files?: { uri: string; name?: string }[]) => unknown
  disabled?: boolean
  working?: boolean
  onStop?: () => unknown
  placeholder?: string
  initialText?: string
  initialSelection?: { start: number; end: number }
  initialError?: string
  droppedAttachments?: number
  onDraftChange?: (value: { text: string; selection: { start: number; end: number }; droppedAttachments: number }) => void
  onFindFiles?: (query: string, signal: AbortSignal) => Promise<string[]>
  stopping?: boolean
}

export function Composer(props: ComposerProps) {
  return (
    <PromptInputProvider initialInput={props.initialText}>
      <ComposerForm {...props} />
    </PromptInputProvider>
  )
}

function ComposerForm({
  agents,
  models,
  agentId,
  modelId,
  onChangeAgent,
  onChangeModel,
  onSend,
  onQueue,
  disabled,
  working,
  onStop,
  placeholder = "Message the agent…",
  initialText = "",
  initialSelection,
  initialError = "",
  droppedAttachments = 0,
  onDraftChange,
  onFindFiles,
  stopping,
}: ComposerProps) {
  const controller = usePromptInputController()
  const attachments = usePromptInputAttachments()
  const [selection, setSelection] = useState(initialSelection ?? { start: initialText.length, end: initialText.length })
  const [mentionedFiles, setMentionedFiles] = useState<AttachedFile[]>([])
  const [fileResults, setFileResults] = useState<string[]>([])
  const [error, setError] = useState(initialError)
  const [submitting, setSubmitting] = useState(false)
  const delivery = useRef<"send" | "queue">("send")
  const attachmentBytes = useRef<number[]>([])
  const totalAttachmentBytes = useRef(0)
  const hasFinePointer = useMediaQuery("(any-pointer: fine)")
  const text = controller.textInput.value
  const mention = text.slice(0, selection.start).match(/(?:^|\s)@([^\s]*)$/)?.[1]
  const attachmentCount = attachments.files.length + mentionedFiles.length
  const stoppingControl = Boolean(working && onStop)

  useEffect(() => {
    if (mention === undefined || !onFindFiles) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      void onFindFiles(mention, controller.signal).then(setFileResults).catch(() => {})
    }, 150)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [mention, onFindFiles])

  function updateDraft(nextText = text, nextSelection = selection, nextAttachmentCount = attachmentCount) {
    onDraftChange?.({ text: nextText, selection: nextSelection, droppedAttachments: nextAttachmentCount })
  }

  function addAttachments(selected: File[] | FileList) {
    if (submitting) return
    const incoming = Array.from(selected)
    const bytes = incoming.reduce((total, file) => total + file.size, 0)
    if (
      incoming.some((file) => file.size > MAX_ATTACHMENT_BYTES) ||
      totalAttachmentBytes.current + bytes > MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      setError(ATTACHMENT_ERROR)
      return
    }
    attachmentBytes.current.push(...incoming.map((file) => file.size))
    totalAttachmentBytes.current += bytes
    attachments.add(incoming)
    updateDraft(text, selection, attachmentCount + incoming.length)
    setError("")
  }

  function removeAttachment(id: string) {
    const index = attachments.files.findIndex((file) => file.id === id)
    if (index >= 0) {
      totalAttachmentBytes.current -= attachmentBytes.current[index] ?? 0
      attachmentBytes.current.splice(index, 1)
    }
    attachments.remove(id)
    updateDraft(text, selection, attachmentCount - 1)
  }

  function chooseMention(path: string) {
    const before = text.slice(0, selection.start).replace(/@[^\s]*$/, `@${path} `)
    const next = before + text.slice(selection.end)
    const nextSelection = { start: before.length, end: before.length }
    const nextFiles = mentionedFiles.some((file) => file.uri === `file:${path}`)
      ? mentionedFiles
      : [...mentionedFiles, { uri: `file:${path}`, name: path }]
    controller.textInput.setInput(next)
    setSelection(nextSelection)
    setMentionedFiles(nextFiles)
    updateDraft(next, nextSelection, attachments.files.length + nextFiles.length)
    setFileResults([])
  }

  function removeMention(uri: string) {
    const nextFiles = mentionedFiles.filter((file) => file.uri !== uri)
    setMentionedFiles(nextFiles)
    updateDraft(text, selection, attachments.files.length + nextFiles.length)
  }

  async function submit(message: { text: string; files: FileUIPart[] }) {
    const mode = delivery.current
    delivery.current = "send"
    const trimmed = message.text.trim()
    if (!trimmed) {
      setSubmitting(false)
      controller.textInput.setInput("")
      setSelection({ start: 0, end: 0 })
      updateDraft("", { start: 0, end: 0 })
      throw new Error("Message is empty.")
    }
    setError("")
    await Promise.resolve()
      .then(() => (mode === "queue" ? onQueue : onSend)(trimmed, [
        ...message.files.map((file) => ({ uri: file.url, name: file.filename })),
        ...mentionedFiles.map((file) => ({ uri: file.uri, name: file.name })),
      ]))
      .then(() => {
        attachmentBytes.current = []
        totalAttachmentBytes.current = 0
        setMentionedFiles([])
        setSelection({ start: 0, end: 0 })
        updateDraft("", { start: 0, end: 0 }, 0)
      }, (cause) => {
        setError(cause instanceof Error ? cause.message : "The message could not be sent.")
        throw cause
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <div
      className="contents"
      onChangeCapture={(event) => {
        if (!(event.target instanceof HTMLInputElement) || event.target.type !== "file" || !event.target.files) return
        event.stopPropagation()
        addAttachments(event.target.files)
        event.target.value = ""
      }}
    >
    <PromptInput
      multiple
      onDropCapture={(event) => {
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        addAttachments(event.dataTransfer.files)
      }}
      onSubmitCapture={() => setSubmitting(true)}
      onSubmit={submit}
    >
      {attachmentCount > 0 || droppedAttachments > 0 || error ? (
        <PromptInputHeader className="flex-col items-stretch">
          {attachmentCount > 0 ? (
            <Attachments variant="inline">
              {attachments.files.map((file) => (
                <Attachment
                  key={file.id}
                  data={file}
                  onRemove={() => removeAttachment(file.id)}
                >
                  <AttachmentPreview />
                  <AttachmentInfo />
                  <AttachmentRemove disabled={submitting} label={`Remove ${file.filename ?? "attachment"}`} className="opacity-100" />
                </Attachment>
              ))}
              {mentionedFiles.map((file) => (
                <Attachment
                  key={file.uri}
                  data={{ id: file.uri, type: "file", filename: file.name, mediaType: "application/octet-stream", url: file.uri }}
                  onRemove={() => removeMention(file.uri)}
                >
                  <AttachmentPreview />
                  <AttachmentInfo />
                  <AttachmentRemove disabled={submitting} label={`Remove ${file.name ?? "attachment"}`} className="opacity-100" />
                </Attachment>
              ))}
            </Attachments>
          ) : null}
          {droppedAttachments > 0 && attachmentCount === 0 ? (
            <p className="text-xs text-muted-foreground">
              {droppedAttachments} attachment{droppedAttachments === 1 ? " was" : "s were"} not restored after reload.
            </p>
          ) : null}
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </PromptInputHeader>
      ) : null}
      <PromptInputBody>
        <InputGroupTextarea
          aria-label="Message"
          name="message"
          value={text}
          onChange={(event) => {
            const nextSelection = { start: event.target.selectionStart, end: event.target.selectionEnd }
            controller.textInput.setInput(event.target.value)
            setSelection(nextSelection)
            updateDraft(event.target.value, nextSelection)
          }}
          onSelect={(event) => {
            const nextSelection = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }
            setSelection(nextSelection)
            updateDraft(text, nextSelection)
          }}
          onKeyDown={(event) => {
            const action = getComposerEnterAction(event, hasFinePointer)
            if (!action) return
            event.preventDefault()
            delivery.current = action
            event.currentTarget.form?.requestSubmit()
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length === 0) return
            event.preventDefault()
            addAttachments(files)
          }}
          placeholder={placeholder}
          disabled={disabled || submitting}
          className="field-sizing-content max-h-48 min-h-16"
        />
      </PromptInputBody>
      {!submitting && mention !== undefined && fileResults.length > 0 ? (
        <PromptInputCommand shouldFilter={false} className="max-h-40 rounded-none border-y">
          <PromptInputCommandList>
            <PromptInputCommandGroup heading="Matching files">
              {fileResults.map((path) => (
                <PromptInputCommandItem key={path} value={path} onSelect={() => chooseMention(path)}>
                  {path}
                </PromptInputCommandItem>
              ))}
            </PromptInputCommandGroup>
          </PromptInputCommandList>
        </PromptInputCommand>
      ) : null}
      <PromptInputFooter>
        <PromptInputTools>
          <AgentModelPicker
            agents={agents}
            models={models}
            agentId={agentId}
            modelId={modelId}
            onChangeAgent={onChangeAgent}
            onChangeModel={onChangeModel}
            disabled={disabled || submitting}
          />
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger disabled={disabled || submitting} aria-label="Attach files" tooltip="Attach files">
              <Paperclip />
            </PromptInputActionMenuTrigger>
            <PromptInputActionMenuContent>
              <DropdownMenuGroup>
                <PromptInputActionAddAttachments />
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
        </PromptInputTools>
        <PromptInputSubmit
          status={stoppingControl ? "streaming" : undefined}
          onStop={onStop}
          variant={stoppingControl ? "destructive" : "default"}
          aria-label={stoppingControl ? (stopping ? "Stopping session" : "Stop session") : "Send message"}
          disabled={stopping || submitting || (!stoppingControl && (disabled || text.trim().length === 0))}
          className="hit-area"
        />
      </PromptInputFooter>
    </PromptInput>
    </div>
  )
}
