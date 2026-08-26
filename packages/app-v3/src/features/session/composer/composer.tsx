import { useEffect, useRef, useState } from "react"
import { ArrowUp, Paperclip, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import type { Agent, Model } from "@/lib/types"
import { AgentModelPicker } from "./agent-model-picker"
import { getComposerEnterAction } from "./should-send-on-enter"

export function Composer({
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
}: {
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
}) {
  const [text, setText] = useState(initialText)
  const [selection, setSelection] = useState(initialSelection ?? { start: initialText.length, end: initialText.length })
  const [files, setFiles] = useState<{ uri: string; name?: string; bytes: number }[]>([])
  const [fileResults, setFileResults] = useState<string[]>([])
  const [error, setError] = useState(initialError)
  const fileInput = useRef<HTMLInputElement>(null)
  const hasFinePointer = useMediaQuery("(any-pointer: fine)")
  const mention = text.slice(0, selection.start).match(/(?:^|\s)@([^\s]*)$/)?.[1]

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

  const matchingFiles = mention === undefined ? [] : fileResults

  function updateDraft(nextText = text, nextSelection = selection, nextFiles = files) {
    onDraftChange?.({ text: nextText, selection: nextSelection, droppedAttachments: nextFiles.length })
  }

  function submit(delivery: "send" | "queue") {
    const trimmed = text.trim()
    if (!trimmed) return
    setText("")
    setError("")
    updateDraft("", { start: 0, end: 0 }, [])
    try {
      const result = delivery === "queue" ? onQueue(trimmed, files) : onSend(trimmed, files)
      setFiles([])
      void Promise.resolve(result).catch((cause) => {
        setText((current) => current || trimmed)
        setFiles(files)
        setError(cause instanceof Error ? cause.message : "The message could not be sent.")
        updateDraft(trimmed, selection, files)
      })
    } catch (cause) {
      setText(trimmed)
      setError(cause instanceof Error ? cause.message : "The message could not be sent.")
      updateDraft(trimmed, selection, files)
    }
  }

  async function attach(selected: FileList | null) {
    const incoming = selected ? Array.from(selected) : []
    const total = files.reduce((bytes, file) => bytes + file.bytes, 0) + incoming.reduce((bytes, file) => bytes + file.size, 0)
    if (incoming.some((file) => file.size > 5 * 1024 * 1024) || total > 20 * 1024 * 1024) {
      setError("Each attachment must be 5 MiB or smaller and attachments must total 20 MiB or less.")
      return
    }
    const encoded = await Promise.all(incoming.map(async (file) => ({ uri: await dataUri(file), name: file.name, bytes: file.size })))
    const nextFiles = [...files, ...encoded]
    setFiles(nextFiles)
    updateDraft(text, selection, nextFiles)
    setError("")
  }

  function chooseMention(path: string) {
    const before = text.slice(0, selection.start).replace(/@[^\s]*$/, `@${path} `)
    const next = before + text.slice(selection.end)
    setText(next)
    const nextSelection = { start: before.length, end: before.length }
    const nextFiles = files.some((file) => file.uri === `file:${path}`)
      ? files
      : [...files, { uri: `file:${path}`, name: path, bytes: 0 }]
    setSelection(nextSelection)
    setFiles(nextFiles)
    updateDraft(next, nextSelection, nextFiles)
    setFileResults([])
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <Textarea
        aria-label="Message"
        value={text}
        onChange={(event) => {
          const nextSelection = { start: event.target.selectionStart, end: event.target.selectionEnd }
          setText(event.target.value)
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
          submit(action)
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-16 resize-none border-none shadow-none focus-visible:ring-0"
      />
      {matchingFiles.length > 0 ? (
        <div role="listbox" aria-label="Matching files" className="max-h-40 overflow-y-auto rounded-md border bg-popover p-1">
          {matchingFiles.map((path) => <button key={path} type="button" role="option" aria-selected="false" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent" onClick={() => chooseMention(path)}>{path}</button>)}
        </div>
      ) : null}
      {files.length > 0 ? <div className="flex flex-wrap gap-1">{files.map((file) => (
        <span key={file.uri} className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
          {file.name ?? "Attachment"}
          <button type="button" aria-label={`Remove ${file.name ?? "attachment"}`} onClick={() => {
            const nextFiles = files.filter((item) => item.uri !== file.uri)
            setFiles(nextFiles)
            updateDraft(text, selection, nextFiles)
          }}><X className="size-3" /></button>
        </span>
      ))}</div> : null}
      {droppedAttachments > 0 && files.length === 0 ? <p className="text-xs text-muted-foreground">{droppedAttachments} attachment{droppedAttachments === 1 ? " was" : "s were"} not restored after reload.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <AgentModelPicker
          agents={agents}
          models={models}
          agentId={agentId}
          modelId={modelId}
          onChangeAgent={onChangeAgent}
          onChangeModel={onChangeModel}
        />
        <input ref={fileInput} type="file" multiple aria-label="Choose files" className="sr-only" onChange={(event) => void attach(event.target.files)} />
        <Button type="button" size="icon" variant="ghost" aria-label="Attach files" onClick={() => fileInput.current?.click()} className="shrink-0 hit-area"><Paperclip /></Button>
        {working && onStop ? (
          <Button size="icon" variant="destructive" aria-label={stopping ? "Stopping session" : "Stop session"} disabled={stopping} onClick={onStop} className="shrink-0 hit-area">
            <Square />
          </Button>
        ) : (
          <Button
            size="icon"
            aria-label="Send message"
            disabled={disabled || text.trim().length === 0}
            onClick={() => submit("send")}
            className="shrink-0 hit-area"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  )
}

function dataUri(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read attachment"))
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment"))
    reader.readAsDataURL(file)
  })
}
