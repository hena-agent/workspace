import type { Agent, Model, PermissionRequest, QuestionRequest, Session, SessionMessage, Todo } from "@/lib/types"
import { Composer } from "./composer/composer"
import { PermissionDock } from "./composer/permission-dock"
import { QuestionDock } from "./composer/question-dock"
import { TodoDock } from "./composer/todo-dock"
import { MessageList } from "./message-list"
import { SessionTranscriptHeader } from "./session-transcript-header"
import { Button } from "@/components/ui/button"
import type { DraftBody } from "@/local-state/drafts"

export function SessionTranscriptView({
  session,
  messages,
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
      <MessageList messages={messages} working={session.status === "working"} />
      <div className="flex flex-col gap-2 border-t p-3">
        <TodoDock todos={todos} />
        {mutationNotice ? <p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{mutationNotice}</p> : null}
        {queuedInputs.length > 0 ? (
          <div className="rounded-md border bg-muted/30 p-2" aria-label="Queued messages">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Queued</div>
            {queuedInputs.map((input, index) => (
              <div key={input.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">{input.text}</span>
                <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMoveInput?.(input.id, -1)}>Up</Button>
                <Button size="sm" variant="ghost" disabled={index === queuedInputs.length - 1} onClick={() => onMoveInput?.(input.id, 1)}>Down</Button>
                <Button size="sm" variant="ghost" onClick={() => onCancelInput?.(input.id)}>Cancel</Button>
              </div>
            ))}
          </div>
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
