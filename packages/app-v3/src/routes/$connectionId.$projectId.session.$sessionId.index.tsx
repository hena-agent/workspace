import { useEffect, useLayoutEffect, useState } from "react"
import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { SessionTranscriptView } from "@/features/session/session-transcript-view"
import { SessionFilesPanel, useSessionFiles } from "@/features/session/session-files-panel"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { loadFileMatches, useCatalog, useCollectionReady, useMessages, usePendingRequest, usePermission, useQuestion, useQueuedInputs, useSession, useSessionLocation, useSettings, useTodos } from "@/data/queries"
import { admitPromptOptimistically, cancelInputOptimistically, interruptOptimistically, isSessionStopping, markSessionsReadOptimistically, reorderInputsOptimistically, replyPermissionOptimistically, replyQuestionOptimistically } from "@/mutations/session"
import { loadDraft, saveDraft } from "@/local-state/drafts"
import { markSessionOpened } from "@/local-state/recent"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/")({
  component: SessionTranscriptRoute,
})

function SessionTranscriptRoute() {
  const params = Route.useParams()
  const router = useRouter()
  const locationParams = useLocation({
    select: (location) => router.matchRoutes(location.pathname).find((match) => match.routeId === Route.id)?.params,
  })
  const connectionId = locationParams?.connectionId ?? params.connectionId
  const projectId = locationParams?.projectId ?? params.projectId
  const sessionId = locationParams?.sessionId ?? params.sessionId
  return (
    <SessionTranscript
      key={`${connectionId}\0${projectId}\0${sessionId}`}
      connectionId={connectionId}
      projectId={projectId}
      sessionId={sessionId}
    />
  )
}

function SessionTranscript({
  connectionId,
  projectId,
  sessionId,
}: {
  connectionId: string
  projectId: string
  sessionId: string
}) {
  const queryClient = useQueryClient()
  const agent = useConnectionAgent(connectionId)
  useLayoutEffect(() => agent?.claim(sessionId), [agent, sessionId])
  const session = useSession(agent, sessionId)
  const location = useSessionLocation(agent, sessionId)
  const catalog = useCatalog(agent, location)
  const settings = useSettings(agent, location ? JSON.stringify(location) : "missing")
  const transcript = useMessages(agent, sessionId)
  const todos = useTodos(agent, sessionId)
  const permission = usePermission(agent, sessionId)
  const question = useQuestion(agent, sessionId)
  const permissionWire = usePendingRequest(agent, "permissions", sessionId)
  const questionWire = usePendingRequest(agent, "questions", sessionId)
  const queue = useQueuedInputs(agent, sessionId)
  const sessionsReady = useCollectionReady(agent, "sessions")
  const sessionFiles = useSessionFiles()
  const [agentId, setAgentId] = useState("")
  const [modelId, setModelId] = useState("")
  const [mutationNotice, setMutationNotice] = useState("")
  const selectedAgentId = agentId || (typeof settings.defaultAgent === "string" ? settings.defaultAgent : session?.agentId) || catalog.agents[0]?.id || ""
  const selectedModelId = modelId || settingModelID(settings.defaultModel) || session?.model?.id || catalog.models[0]?.id || ""
  const draftKey = `session:${sessionId}`
  const draft = agent ? loadDraft(agent.url, draftKey) : undefined
  useEffect(() => {
    if (agent && session) markSessionOpened(agent.url, sessionId)
  }, [agent, session, sessionId])
  useEffect(() => {
    // Gated on settled (not `working`), not on `unread`: an open session's `time.updated` keeps
    // advancing while it streams, so marking read on every tick would fire a mutation per token,
    // and the working spinner already masks the unread dot until then. Deliberately NOT gated on
    // `unread` itself -- that flag is the mutation's own optimistic side effect, so a failed
    // mutation rolling it back to `true` would immediately re-trigger this effect and retry
    // forever. The server no-ops a redundant mark-read, so calling on every settle is harmless.
    if (agent && session && session.status !== "working")
      void markSessionsReadOptimistically(agent, [sessionId]).catch(() => {})
  }, [agent, session?.status, sessionId])
  const replyPermission = (reply: "once" | "always" | "reject") => {
    if (!agent || !location || !permissionWire || typeof permissionWire.id !== "string" || typeof permissionWire.nonce !== "string") return
    setMutationNotice("")
    return replyPermissionOptimistically(agent, { id: permissionWire.id, sessionID: sessionId, nonce: permissionWire.nonce, location, reply })
      .then((result) => {
        if (result.divergent) setMutationNotice("This permission request was already resolved differently by another actor.")
        return result
      }).catch((cause) => {
        setMutationNotice(cause instanceof Error ? cause.message : "The permission reply could not be saved.")
      })
  }

  if (!session) {
    return <RouteLoadingState agent={agent} ready={sessionsReady} missing="Session not found." />
  }

  return (
    <div className="flex h-full w-full min-w-0">
      <div className="min-w-0 flex-1">
        <SessionTranscriptView
          session={session}
          messages={transcript.messages}
          messagesReady={transcript.ready}
          todos={todos}
          permissionRequest={permission}
          questionRequest={question}
          agents={catalog.agents}
          models={catalog.models}
          agentId={selectedAgentId}
          modelId={selectedModelId}
          onChangeAgent={setAgentId}
          onChangeModel={setModelId}
          draft={draft}
          onDraftChange={(value) => {
            if (agent) saveDraft(agent.url, draftKey, `/${connectionId}/${projectId}/session/${sessionId}`, value)
          }}
          onFindFiles={(query, signal) => {
            if (!agent || !location) return Promise.resolve([])
            return queryClient.fetchQuery({
              queryKey: [agent.url, "fs.find", location.directory, location.workspaceID, query],
              queryFn: () => loadFileMatches(agent, location, query, signal),
            })
          }}
          stopping={isSessionStopping(agent, sessionId)}
          mutationNotice={mutationNotice}
          onSend={(text, files) => {
        if (!agent) return Promise.reject(new Error("Server is unavailable"))
        const result = admitPromptOptimistically(agent, {
          sessionID: sessionId,
          text,
          files,
          delivery: settings.queueDelivery === "queue" ? "queue" : "steer",
          agentID: selectedAgentId || undefined,
          model: selectedModel(catalog.models, selectedModelId),
        }).transaction.isPersisted.promise
        return result
          }}
          onQueue={(text, files) => {
        if (!agent) return Promise.reject(new Error("Server is unavailable"))
        const result = admitPromptOptimistically(agent, {
          sessionID: sessionId,
          text,
          files,
          delivery: "queue",
          agentID: selectedAgentId || undefined,
          model: selectedModel(catalog.models, selectedModelId),
        }).transaction.isPersisted.promise
        return result
          }}
          queuedInputs={queue.items}
          onCancelInput={(messageID) => {
        if (!agent) return
        setMutationNotice("")
        return cancelInputOptimistically(agent, { sessionID: sessionId, messageID, expectedRevision: queue.revision })
          .catch((cause) => {
            setMutationNotice(cause instanceof Error ? `Queue restored: ${cause.message}` : "Queue restored after a conflict.")
          })
          }}
          onMoveInput={(messageID, direction) => {
        if (!agent) return
        const index = queue.items.findIndex((item) => item.id === messageID)
        const target = index + direction
        if (index < 0 || target < 0 || target >= queue.items.length) return
        const messageIDs = queue.items.map((item) => item.id)
        ;[messageIDs[index], messageIDs[target]] = [messageIDs[target], messageIDs[index]]
        setMutationNotice("")
        return reorderInputsOptimistically(agent, { sessionID: sessionId, messageIDs, expectedRevision: queue.revision })
          .catch((cause) => {
            setMutationNotice(cause instanceof Error ? `Queue order restored: ${cause.message}` : "Queue order restored after a conflict.")
          })
          }}
          onStop={() => {
        if (!agent) return
        setMutationNotice("")
        return interruptOptimistically(agent, sessionId).catch((cause) => {
          setMutationNotice(cause instanceof Error ? cause.message : "The session could not be stopped.")
        })
          }}
          onDenyPermission={() => replyPermission("reject")}
          onAllowPermissionOnce={() => replyPermission("once")}
          onAllowPermissionAlways={() => replyPermission("always")}
          onAnswerQuestion={(choiceId) => {
        if (!agent || !location || !questionWire || typeof questionWire.id !== "string" || typeof questionWire.nonce !== "string") return
        const label = question?.choices.find((choice) => choice.id === choiceId)?.label
        if (!label) return
        setMutationNotice("")
        return replyQuestionOptimistically(agent, { id: questionWire.id, sessionID: sessionId, nonce: questionWire.nonce, location, answers: [[label]] })
          .then((result) => {
            if (result.divergent) setMutationNotice("This question was already answered differently by another actor.")
            return result
          }).catch((cause) => {
            setMutationNotice(cause instanceof Error ? cause.message : "The answer could not be saved.")
          })
          }}
        />
      </div>
      {sessionFiles.open ? <SessionFilesPanel connectionId={connectionId} sessionId={sessionId} /> : null}
    </div>
  )

}

function settingModelID(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string"
    ? String((value as Record<string, unknown>).id)
    : undefined
}

function selectedModel(models: { id: string; providerId: string }[], id: string) {
  const model = models.find((item) => item.id === id)
  return model ? { id: model.id, providerID: model.providerId } : undefined
}
