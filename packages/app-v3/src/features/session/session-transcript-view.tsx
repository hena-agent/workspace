import type { Agent, Model, PermissionRequest, QuestionRequest, Session, SessionMessage, Todo } from "@/lib/types"
import { Composer } from "./composer/composer"
import { PermissionDock } from "./composer/permission-dock"
import { QuestionDock } from "./composer/question-dock"
import { TodoDock } from "./composer/todo-dock"
import { MessageList } from "./message-list"
import { SessionTranscriptHeader } from "./session-transcript-header"

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
  onSend: (text: string) => void
  onQueue: (text: string) => void
  onShare: () => void
  onFork: () => void
  onArchive: () => void
  onDenyPermission: () => void
  onAllowPermissionOnce: () => void
  onAllowPermissionAlways: () => void
  onAnswerQuestion: (choiceId: string) => void
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <SessionTranscriptHeader session={session} onShare={onShare} onFork={onFork} onArchive={onArchive} />
      <MessageList messages={messages} />
      <div className="flex flex-col gap-2 border-t p-3">
        <TodoDock todos={todos} />
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
        />
      </div>
    </div>
  )
}
