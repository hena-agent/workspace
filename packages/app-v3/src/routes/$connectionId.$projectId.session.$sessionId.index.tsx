import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { SessionTranscriptView } from "@/features/session/session-transcript-view"
import { useMockServers } from "@/features/server/mock-server-provider"
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
  const server = useMockServers().getServerBySlug(connectionId)
  const session = server ? getSession({ id: sessionId, connectionId: server.id, projectId }) : undefined
  const agents = listAgents()
  const models = listModels()
  const [agentId, setAgentId] = useState(agents[0].id)
  const [modelId, setModelId] = useState(models[0].id)

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Session not found.</div>
    )
  }

  const sessionOwner = { sessionId, connectionId: session.connectionId, projectId }

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
      onQueue={() => {}}
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
