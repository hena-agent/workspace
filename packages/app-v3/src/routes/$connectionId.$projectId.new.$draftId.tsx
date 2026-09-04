import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { NewSessionView } from "@/features/new-session/new-session-view"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { loadFileMatches, useCatalog, useCollectionReady, useProject, useSettings } from "@/data/queries"
import { createSessionOptimistically } from "@/mutations/session"
import { loadDraft, saveDraft } from "@/local-state/drafts"
import type { ModelRef } from "@/lib/types"

export const Route = createFileRoute("/$connectionId/$projectId/new/$draftId")({
  component: NewSessionRoute,
  remountDeps: ({ params }) => params,
})

function NewSessionRoute() {
  const { connectionId, projectId, draftId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const agent = useConnectionAgent(connectionId)
  const project = useProject(agent, projectId)
  const location: { directory: string; workspaceID?: string } | undefined = project ? { directory: project.path } : undefined
  const catalog = useCatalog(agent, location)
  const settings = useSettings(agent, location ? JSON.stringify(location) : "missing")
  const projectsReady = useCollectionReady(agent, "projects")
  const draft = agent ? loadDraft(agent.url, draftId) : undefined

  if (!project) {
    return <RouteLoadingState agent={agent} ready={projectsReady} missing="Project not found." />
  }

  return (
    <NewSessionView
      project={project}
      agents={catalog.agents}
      models={catalog.models}
      providers={catalog.providers}
      defaultAgentId={typeof settings.defaultAgent === "string" ? settings.defaultAgent : undefined}
      defaultModel={settingModel(settings.defaultModel)}
      defaultDelivery={settings.queueDelivery === "queue" ? "queue" : "steer"}
      draft={draft}
      onDraftChange={(value) => {
        if (agent) saveDraft(agent.url, draftId, `/${connectionId}/${projectId}/new/${draftId}`, value)
      }}
      onFindFiles={(query, signal) => {
        if (!agent || !location) return Promise.resolve([])
        return queryClient.fetchQuery({
          queryKey: [agent.url, "fs.find", location.directory, location.workspaceID, query],
          queryFn: () => loadFileMatches(agent, location, query, signal),
        })
      }}
      onStart={({ text, files, agentId, model, delivery }) => {
        if (!agent) return
        saveDraft(agent.url, draftId, `/${connectionId}/${projectId}/new/${draftId}`, {
          text,
          selection: { start: text.length, end: text.length },
          agentID: agentId || undefined,
          model,
          delivery: delivery === "queue" ? "queue" : "steer",
          droppedAttachments: files?.length ?? 0,
        })
        const created = createSessionOptimistically(agent, {
          projectID: projectId,
          location: { directory: project.path },
          text,
          files,
          agentID: agentId,
          model: modelWire(catalog.models, model),
          delivery: delivery === "queue" ? "queue" : "steer",
        })
        void navigate({
          to: "/$connectionId/$projectId/session/$sessionId",
          params: { connectionId, projectId, sessionId: created.sessionID },
        })
        return created.transaction.isPersisted.promise.catch((cause) => {
          const current = loadDraft(agent.url, draftId)
          if (current) saveDraft(agent.url, draftId, `/${connectionId}/${projectId}/new/${draftId}`, {
            ...current,
            error: cause instanceof Error ? cause.message : "The session could not be created.",
          })
          void navigate({ to: "/$connectionId/$projectId/new/$draftId", params: { connectionId, projectId, draftId } })
          throw cause
        })
      }}
    />
  )
}

function settingModel(value: unknown): ModelRef | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return typeof record.id === "string" && typeof record.providerID === "string"
    ? { id: record.id, providerId: record.providerID }
    : undefined
}

// Confirms the picked model is still in the catalog before sending it over the wire, so a
// stale selection (e.g. a provider disconnected after the pick) falls back to no model.
function modelWire(models: ModelRef[], model: ModelRef | undefined) {
  if (!model) return undefined
  const known = models.some((item) => item.id === model.id && item.providerId === model.providerId)
  return known ? { id: model.id, providerID: model.providerId } : undefined
}
