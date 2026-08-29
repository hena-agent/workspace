import { encodeServerSlug } from "@/lib/server-url"
import type { Project } from "@/lib/types"

type ProjectOrderStore = { version: 1; projects: string[] }

export function loadProjectOrder(url: string, storage: Storage = localStorage) {
  const value = record(parse(storage.getItem(storageKey(url))))
  if (value.version !== 1 || !Array.isArray(value.projects)) return []
  return [...new Set(value.projects.filter((id): id is string => typeof id === "string"))]
}

export function saveProjectOrder(url: string, projects: Project[], storage: Storage = localStorage) {
  storage.setItem(
    storageKey(url),
    JSON.stringify({
      version: 1,
      projects: [...new Set(projects.map((project) => project.id))],
    } satisfies ProjectOrderStore),
  )
}

export function applyProjectOrder(projects: Project[], order: string[]) {
  if (order.length === 0) return projects
  const byId = new Map(projects.map((project) => [project.id, project]))
  const saved = new Set(order)
  return [
    ...projects.filter((project) => !saved.has(project.id)),
    ...order.flatMap((id) => {
      const project = byId.get(id)
      return project ? [project] : []
    }),
  ]
}

function storageKey(url: string) {
  return `hena.project-order.v1.${encodeServerSlug(url)}`
}

function parse(value: string | null) {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
