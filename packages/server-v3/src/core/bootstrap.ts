import type { SyncDatabase } from "../storage/database"
import type { CoreDomain } from "./domain"
import type { OnlineRequestStore } from "./online-requests"

type ProjectRow = {
  id: string
  worktree: string
  vcs: string | null
  name: string | null
  icon_url: string | null
  icon_url_override: string | null
  icon_color: string | null
  time_created: number
  time_updated: number
  time_initialized: number | null
  sandboxes: string
  commands: string | null
}

type SessionRow = {
  id: string
  project_id: string
  workspace_id: string | null
  parent_id: string | null
  directory: string
  path: string | null
  title: string
  agent: string | null
  model: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  revert: string | null
  time_created: number
  time_updated: number
  time_archived: number | null
  queue_revision: number
}

export function bootstrapCollections(database: SyncDatabase) {
  const projects = database.raw.query<ProjectRow, []>("SELECT * FROM project ORDER BY id").all()
  database.collections.hydrate("projects", "", projects.map((project) => ({
    key: project.id,
    revision: String(project.time_updated),
    row: {
      id: project.id,
      worktree: project.worktree,
      vcs: project.vcs ?? undefined,
      name: project.name ?? undefined,
      icon: project.icon_url || project.icon_url_override || project.icon_color ? {
        url: project.icon_url ?? undefined,
        override: project.icon_url_override ?? undefined,
        color: project.icon_color ?? undefined,
      } : undefined,
      commands: parseJson(project.commands),
      sandboxes: parseJson(project.sandboxes) ?? [],
      time: { created: project.time_created, updated: project.time_updated, initialized: project.time_initialized ?? undefined },
    },
  })))

  const sessions = database.raw.query<SessionRow, []>("SELECT * FROM session ORDER BY id").all()
  database.collections.hydrate("sessions", "", sessions.map((session) => ({
    key: session.id,
    revision: String(session.time_updated),
    row: sessionRow(session),
  })))
  const locations = new Map(projects.map((project) => {
    const ref = { directory: project.worktree }
    return [JSON.stringify(ref), ref]
  }))
  sessions.forEach((session) => {
    const ref = { directory: session.directory, ...(session.workspace_id ? { workspaceID: session.workspace_id } : {}) }
    locations.set(JSON.stringify(ref), ref)
  })
  database.collections.hydrate("locations", "", Array.from(locations, ([key, row]) => ({ key, row, revision: "1" })))
}

export async function bootstrapLocationCollections(database: SyncDatabase, domain: CoreDomain, online: OnlineRequestStore) {
  await Promise.all(database.collections.snapshot("locations", "").rows.map(async (location) => {
    const ref = location.row as { directory: string; workspaceID?: string }
    const catalog = await domain.catalog(ref)
    online.replace("agents", location.key, catalog.agents.map((agent) => ({
      key: agent.id,
      row: {
        id: agent.id,
        model: agent.model,
        description: agent.description,
        mode: agent.mode,
        hidden: agent.hidden,
        color: agent.color,
        steps: agent.steps,
        permissions: agent.permissions,
      },
    })))
    online.replace("models", location.key, catalog.models.map((model) => ({
      key: JSON.stringify([model.providerID, model.id]),
      row: {
        id: model.id,
        providerID: model.providerID,
        family: model.family,
        name: model.name,
        capabilities: model.capabilities,
        variants: model.variants.map((variant) => ({ id: variant.id })),
        time: model.time,
        cost: model.cost,
        status: model.status,
        enabled: model.enabled,
        limit: model.limit,
      },
    })))
    online.replace("providers", location.key, catalog.providers.map((provider) => ({
      key: provider.id,
      row: {
        id: provider.id,
        integrationID: provider.integrationID,
        name: provider.name,
        disabled: provider.disabled,
      },
    })))
  }))
}

function sessionRow(session: SessionRow) {
  return {
    id: session.id,
    projectID: session.project_id,
    parentID: session.parent_id ?? undefined,
    title: session.title,
    agent: session.agent ?? undefined,
    model: parseJson(session.model),
    cost: session.cost,
    tokens: {
      input: session.tokens_input,
      output: session.tokens_output,
      reasoning: session.tokens_reasoning,
      cache: { read: session.tokens_cache_read, write: session.tokens_cache_write },
    },
    location: { directory: session.directory, ...(session.workspace_id ? { workspaceID: session.workspace_id } : {}) },
    subpath: session.path ?? undefined,
    revert: parseJson(session.revert),
    queueRevision: session.queue_revision,
    time: { created: session.time_created, updated: session.time_updated, archived: session.time_archived ?? undefined },
  }
}

function parseJson(input: string | null) {
  return input === null ? undefined : JSON.parse(input)
}
