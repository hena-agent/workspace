import { encodeServerSlug } from "@/lib/server-url"

const MAX_RECENT_SESSIONS = 500

// Which session a device last had open, purely to restore it on return. Read state itself is
// server-synced (see `Session.unread` in `@/lib/types`); this only orders session IDs oldest to
// newest so `recentlyOpened(url).findLast(...)` can pick the most recently opened survivor.
export function recentlyOpened(url: string) {
  return read(url)
}

export function markSessionOpened(url: string, sessionID: string) {
  const current = read(url)
  if (current.at(-1) === sessionID) return
  const next = [...current.filter((id) => id !== sessionID), sessionID].slice(-MAX_RECENT_SESSIONS)
  localStorage.setItem(key(url), JSON.stringify(next))
}

function read(url: string): string[] {
  return parse(localStorage.getItem(key(url))).slice(-MAX_RECENT_SESSIONS)
}

function parse(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

function key(url: string) {
  return `hena.recent.v1.${encodeServerSlug(url)}`
}
