import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react"
import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { SessionTranscriptView } from "@/features/session/session-transcript-view"
import { SessionFilesPanel, useSessionFiles } from "@/features/session/session-files-panel"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { loadFileMatches, useCatalog, useCollectionReady, useMessages, usePendingRequest, usePermission, useQuestion, useQueuedInputs, useSession, useSessionLocation, useSettings, useTodos } from "@/data/queries"
import { admitPromptOptimistically, cancelInputOptimistically, interruptOptimistically, isSessionStopping, markSessionsReadOptimistically, reorderInputsOptimistically, replyPermissionOptimistically, replyQuestionOptimistically } from "@/mutations/session"
import type { PromptFile } from "@/mutations/session"
import { loadDraft, saveDraft } from "@/local-state/drafts"
import { markSessionOpened } from "@/local-state/recent"
import type { ModelRef } from "@/lib/types"
import { modelFromWire, modelWire } from "@/lib/model"
import { resolveAgent } from "@/lib/agent"

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
  const focused = useRef<typeof agent>(undefined)
  useLayoutEffect(() => {
    focused.current = agent
    const release = agent?.claim(sessionId)
    return () => {
      focused.current = undefined
      release?.()
    }
  }, [agent, sessionId])
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
  const [model, setModel] = useState<ModelRef | undefined>(undefined)
  const [mutationNotice, setMutationNotice] = useState("")
  const selectedAgentId = resolveAgent(catalog.agents, agentId, typeof settings.defaultAgent === "string" ? settings.defaultAgent : undefined, session?.agentId)?.id ?? ""
  const selectedModel = model ?? modelFromWire(settings.defaultModel) ?? session?.model ?? catalog.models[0]
  const draftKey = `session:${sessionId}`
  const draft = agent ? loadDraft(agent.url, draftKey) : undefined
  useEffect(() => {
    if (agent && session) markSessionOpened(agent.url, sessionId)
  }, [agent, session, sessionId])
  // `useEffectEvent`, not a plain closure: this reads `session.unread`, which is this same
  // mutation's own optimistic output. A plain effect depending on it would let a failed
  // mutation's rollback immediately retrigger itself and retry forever -- `useEffectEvent`
  // always sees the latest `session` without making it (or `unread`) a reactive dependency, so
  // only an agent/session/update-time change below can trigger another call.
  const markReadIfUnread = useEffectEvent(() => {
    if (agent && session?.unread)
      void markSessionsReadOptimistically(agent, [sessionId]).catch(() => {})
  })
  useEffect(() => {
    // Follow the unread watermark's source, including updates without a status transition.
    // Core preserves time_updated when applying usage, so streaming tokens do not trigger receipts.
    markReadIfUnread()
  }, [agent, session?.updatedAt, sessionId])
  const send = async (text: string, files: PromptFile[] | undefined, delivery: "steer" | "queue") => {
    if (!agent) throw new Error("Server is unavailable")
    if (!selectedAgentId) throw new Error("Select an agent before sending.")
    await admitPromptOptimistically(agent, {
      sessionID: sessionId,
      text,
      files,
      delivery,
      agentID: selectedAgentId,
      model: modelWire(catalog.models, selectedModel),
    }).transaction.isPersisted.promise
    // The route may have closed while admission was pending. Read failures, including a
    // removed row throwing synchronously, must not turn an admitted prompt into a send failure.
    void Promise.resolve().then(async () => {
      if (focused.current !== agent || !agent.store.collection("sessions", "").has(sessionId)) return
      await markSessionsReadOptimistically(agent, [sessionId])
    }).catch(() => {})
  }
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
          providers={catalog.providers}
          agentId={selectedAgentId}
          model={selectedModel}
          onChangeAgent={setAgentId}
          onChangeModel={setModel}
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
          onSend={(text, files) => send(text, files, settings.queueDelivery === "queue" ? "queue" : "steer")}
          onQueue={(text, files) => send(text, files, "queue")}
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
