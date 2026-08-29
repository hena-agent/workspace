import { encodeServerSlug } from "@/lib/server-url"

type LastSessionStore = { version: 1; projects: Record<string, string> }

export function loadLastSession(url: string, projectId: string, storage: Storage = localStorage) {
  const value = record(parse(storage.getItem(storageKey(url))))
  if (value.version !== 1) return
  return projects(value.projects)[projectId]
}

export function saveLastSession(url: string, projectId: string, sessionId: string, storage: Storage = localStorage) {
  const value = record(parse(storage.getItem(storageKey(url))))
  const current = value.version === 1 ? projects(value.projects) : {}
  if (current[projectId] === sessionId) return
  storage.setItem(
    storageKey(url),
    JSON.stringify({
      version: 1,
      projects: { ...current, [projectId]: sessionId },
    } satisfies LastSessionStore),
  )
}

function storageKey(url: string) {
  return `hena.last-session.v1.${encodeServerSlug(url)}`
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

function projects(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}
