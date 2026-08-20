import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { SessionTranscriptView } from "@/features/session/session-transcript-view"
import {
  getPermissionRequest,
  getQuestionRequest,
  getSession,
  listAgents,
  listMessages,
  listModels,
  listTodos,
} from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/")({
  component: SessionTranscriptRoute,
  remountDeps: ({ params }) => params,
})

function SessionTranscriptRoute() {
  const { connectionId, projectId, sessionId } = Route.useParams()
  const session = getSession({ id: sessionId, connectionId, projectId })
  const sessionOwner = { sessionId, connectionId, projectId }
  const agents = listAgents()
  const models = listModels()
  const [agentId, setAgentId] = useState(agents[0].id)
  const [modelId, setModelId] = useState(models[0].id)

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Session not found.</div>
    )
  }

  return (
    <SessionTranscriptView
      session={session}
      messages={listMessages(sessionOwner)}
      todos={listTodos(sessionOwner)}
      permissionRequest={getPermissionRequest(sessionOwner)}
      questionRequest={getQuestionRequest(sessionOwner)}
      agents={agents}
      models={models}
      agentId={agentId}
      modelId={modelId}
      onChangeAgent={setAgentId}
      onChangeModel={setModelId}
      onSend={() => {}}
      onShare={() => {}}
      onFork={() => {}}
      onArchive={() => {}}
      onDenyPermission={() => {}}
      onAllowPermissionOnce={() => {}}
      onAllowPermissionAlways={() => {}}
      onAnswerQuestion={() => {}}
    />
  )
}
