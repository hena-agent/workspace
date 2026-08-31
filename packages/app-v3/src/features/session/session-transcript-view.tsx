import type { Agent, Model, PermissionRequest, QuestionRequest, Session, SessionMessage, Todo } from "@/lib/types"
import { ArrowDown, ArrowUp, X } from "lucide-react"
import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemContent,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue"
import { Composer } from "./composer/composer"
import { PermissionDock } from "./composer/permission-dock"
import { QuestionDock } from "./composer/question-dock"
import { TodoDock } from "./composer/todo-dock"
import { MessageList } from "./message-list"
import { SessionTranscriptHeader } from "./session-transcript-header"
import type { DraftBody } from "@/local-state/drafts"

export function SessionTranscriptView({
  session,
  messages,
  messagesReady = true,
  todos,
  permissionRequest,
  questionRequest,
  agents,
  models,
  agentId,
  modelId,
  onChangeAgent,
  onChangeModel,
  onSend,
  onQueue,
  onShare,
  onFork,
  onArchive,
  onDenyPermission,
  onAllowPermissionOnce,
  onAllowPermissionAlways,
  onAnswerQuestion,
  queuedInputs = [],
  onCancelInput,
  onMoveInput,
  onStop,
  draft,
  onDraftChange,
  onFindFiles,
  stopping,
  mutationNotice,
}: {
  session: Session
  messages: SessionMessage[]
  messagesReady?: boolean
  todos: Todo[]
  permissionRequest?: PermissionRequest
  questionRequest?: QuestionRequest
  agents: Agent[]
  models: Model[]
  agentId: string
  modelId: string
  onChangeAgent: (id: string) => void
  onChangeModel: (id: string) => void
  onSend: (text: string, files?: { uri: string; name?: string }[]) => unknown
  onQueue: (text: string, files?: { uri: string; name?: string }[]) => unknown
  onShare?: () => void
  onFork?: () => void
  onArchive?: () => void
  onDenyPermission: () => void
  onAllowPermissionOnce: () => void
  onAllowPermissionAlways: () => void
  onAnswerQuestion: (choiceId: string) => void
  queuedInputs?: { id: string; text: string }[]
  onCancelInput?: (id: string) => unknown
  onMoveInput?: (id: string, direction: -1 | 1) => unknown
  onStop?: () => unknown
  draft?: DraftBody
  onDraftChange?: (draft: DraftBody) => void
  onFindFiles?: (query: string, signal: AbortSignal) => Promise<string[]>
  stopping?: boolean
  mutationNotice?: string
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <SessionTranscriptHeader
        session={session}
        onShare={onShare}
        onFork={onFork}
        onArchive={onArchive}
      />
      <MessageList messages={messages} working={session.status === "working"} ready={messagesReady} />
      <div className="flex flex-col gap-2 border-t p-3">
        <TodoDock todos={todos} />
        {mutationNotice ? <p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{mutationNotice}</p> : null}
        {queuedInputs.length > 0 ? (
          <Queue aria-label="Queued messages" className="rounded-lg px-2 py-1 shadow-none">
            <QueueSection>
              <QueueSectionTrigger className="hit-area bg-transparent px-1 py-1 text-xs text-foreground">
                <QueueSectionLabel count={queuedInputs.length} label={queuedInputs.length === 1 ? "queued message" : "queued messages"} />
              </QueueSectionTrigger>
              <QueueSectionContent>
                <QueueList className="mt-1">
                  {queuedInputs.map((input, index) => (
                    <QueueItem key={input.id} data-queue-input-id={input.id} className="px-1">
                      <div className="flex items-center gap-2">
                        <QueueItemContent className="text-foreground">{input.text}</QueueItemContent>
                        <QueueItemActions>
                          <QueueItemAction aria-label="Up" className="opacity-100" disabled={index === 0} onClick={() => onMoveInput?.(input.id, -1)}><ArrowUp /></QueueItemAction>
                          <QueueItemAction aria-label="Down" className="opacity-100" disabled={index === queuedInputs.length - 1} onClick={() => onMoveInput?.(input.id, 1)}><ArrowDown /></QueueItemAction>
                          <QueueItemAction aria-label="Cancel" className="opacity-100" onClick={() => onCancelInput?.(input.id)}><X /></QueueItemAction>
                        </QueueItemActions>
                      </div>
                    </QueueItem>
                  ))}
                </QueueList>
              </QueueSectionContent>
            </QueueSection>
          </Queue>
        ) : null}
        {questionRequest ? <QuestionDock request={questionRequest} onChoose={onAnswerQuestion} /> : null}
        {permissionRequest ? (
          <PermissionDock
            request={permissionRequest}
            onDeny={onDenyPermission}
            onAllowOnce={onAllowPermissionOnce}
            onAllowAlways={onAllowPermissionAlways}
          />
        ) : null}
        <Composer
          agents={agents}
          models={models}
          agentId={agentId}
          modelId={modelId}
          onChangeAgent={onChangeAgent}
          onChangeModel={onChangeModel}
          onSend={onSend}
          onQueue={onQueue}
          working={session.status === "working"}
          onStop={onStop}
          initialText={draft?.text}
          initialSelection={draft?.selection}
          initialError={draft?.error}
          droppedAttachments={draft?.droppedAttachments}
          onFindFiles={onFindFiles}
          onDraftChange={(value) => onDraftChange?.({
            ...value,
            agentID: agentId || undefined,
            modelID: modelId || undefined,
            delivery: "steer",
          })}
          stopping={stopping}
        />
      </div>
    </div>
  )
}
