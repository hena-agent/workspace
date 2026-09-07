import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { NewSessionView } from "@/features/new-session/new-session-view"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { useLocationCatalog, useSettings } from "@/data/queries"
import { createSessionOptimistically } from "@/mutations/session"
import { loadDraft, saveDraft } from "@/local-state/drafts"
import { modelFromWire, modelWire } from "@/lib/model"

const MAX_DIRECTORY_LENGTH = 4096

// The server only assigns a project's real ID once its first session is created (see
// packages/core/src/project.ts), so the optimistic session row uses this placeholder until the
// session-creation response reports the real one.
const PENDING_PROJECT_ID = "pending"

export const Route = createFileRoute("/$connectionId/new/$draftId")({
  validateSearch: (search: Record<string, unknown>) => ({
    directory:
      typeof search.directory === "string" &&
      search.directory.length > 0 &&
      search.directory.length <= MAX_DIRECTORY_LENGTH
        ? search.directory
        : "",
  }),
  component: NewProjectSessionRoute,
  remountDeps: ({ params }) => params,
})

function NewProjectSessionRoute() {
  const { connectionId, draftId } = Route.useParams()
  const { directory } = Route.useSearch()
  const navigate = useNavigate()
  const agent = useConnectionAgent(connectionId)
  const location: { directory: string; workspaceID?: string } = { directory }
  const catalog = useLocationCatalog(agent, location).data ?? { agents: [], models: [], providers: [] }
  const settings = useSettings(agent, JSON.stringify(location))
  const draft = agent ? loadDraft(agent.url, draftId) : undefined

  if (!agent) {
    return <RouteLoadingState agent={agent} ready={false} missing="" />
  }
  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No directory was provided.
      </div>
    )
  }

  return (
    <NewSessionView
      project={{ name: directory.split(/[\\/]/).filter(Boolean).at(-1) || directory, path: directory }}
      agents={catalog.agents}
      models={catalog.models}
      providers={catalog.providers}
      defaultAgentId={typeof settings.defaultAgent === "string" ? settings.defaultAgent : undefined}
      defaultModel={modelFromWire(settings.defaultModel)}
      defaultDelivery={settings.queueDelivery === "queue" ? "queue" : "steer"}
      draft={draft}
      onDraftChange={(value) => saveDraft(agent.url, draftId, `/${connectionId}/new/${draftId}`, value)}
      onStart={({ text, files, agentId, model, delivery }) => {
        saveDraft(agent.url, draftId, `/${connectionId}/new/${draftId}`, {
          text,
          selection: { start: text.length, end: text.length },
          agentID: agentId || undefined,
          model,
          delivery: delivery === "queue" ? "queue" : "steer",
          droppedAttachments: files?.length ?? 0,
        })
        const created = createSessionOptimistically(agent, {
          projectID: PENDING_PROJECT_ID,
          location,
          text,
          files,
          agentID: agentId,
          model: modelWire(catalog.models, model),
          delivery: delivery === "queue" ? "queue" : "steer",
        })
        void created.projectID.then((projectID) => {
          void navigate({
            to: "/$connectionId/$projectId/session/$sessionId",
            params: { connectionId, projectId: projectID, sessionId: created.sessionID },
          })
        })
        return created.transaction.isPersisted.promise.catch((cause) => {
          const current = loadDraft(agent.url, draftId)
          if (current)
            saveDraft(agent.url, draftId, `/${connectionId}/new/${draftId}`, {
              ...current,
              error: cause instanceof Error ? cause.message : "The session could not be created.",
            })
          void navigate({
            to: "/$connectionId/new/$draftId",
            params: { connectionId, draftId },
            search: { directory },
          })
          throw cause
        })
      }}
    />
  )
}
