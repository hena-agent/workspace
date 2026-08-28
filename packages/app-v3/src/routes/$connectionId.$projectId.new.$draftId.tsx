import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { NewSessionView } from "@/features/new-session/new-session-view"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { loadFileMatches, useCatalog, useCollectionReady, useProject, useSettings } from "@/data/queries"
import { createSessionOptimistically } from "@/mutations/session"
import { loadDraft, saveDraft } from "@/local-state/drafts"

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
      defaultAgentId={typeof settings.defaultAgent === "string" ? settings.defaultAgent : undefined}
      defaultModelId={modelID(settings.defaultModel)}
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
      onStart={({ text, files, agentId, modelId, delivery }) => {
        if (!agent) return
        saveDraft(agent.url, draftId, `/${connectionId}/${projectId}/new/${draftId}`, {
          text,
          selection: { start: text.length, end: text.length },
          agentID: agentId || undefined,
          modelID: modelId || undefined,
          delivery: delivery === "queue" ? "queue" : "steer",
          droppedAttachments: files?.length ?? 0,
        })
        const created = createSessionOptimistically(agent, {
          projectID: projectId,
          location: { directory: project.path },
          text,
          files,
          agentID: agentId,
          model: selectedModel(catalog.models, modelId),
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

function modelID(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return typeof (value as Record<string, unknown>).id === "string" ? (value as Record<string, string>).id : undefined
}

function selectedModel(models: { id: string; providerId: string }[], id: string) {
  const model = models.find((item) => item.id === id)
  return model ? { id: model.id, providerID: model.providerId } : undefined
}
