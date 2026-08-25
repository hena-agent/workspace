import { useSyncExternalStore } from "react"
import { encodeServerSlug } from "@/lib/server-url"

const MAX_SEEN_SESSIONS = 500
const listeners = new Map<string, Set<() => void>>()

export function useSeenWatermarks(url: string | undefined) {
  return useSyncExternalStore(
    url ? (listener) => subscribe(url, listener) : emptySubscribe,
    () => url ? snapshot(url) : "{}",
    () => "{}",
  )
}

export function wasSeenAfter(url: string, sessionID: string, updatedAt: number) {
  return read(url)[sessionID] >= updatedAt
}

export function markSessionSeen(url: string, sessionID: string, updatedAt: number) {
  const current = read(url)
  if (current[sessionID] === updatedAt && Object.keys(current).at(-1) === sessionID) return
  delete current[sessionID]
  current[sessionID] = updatedAt
  const bounded = Object.fromEntries(Object.entries(current).slice(-MAX_SEEN_SESSIONS))
  localStorage.setItem(key(url), JSON.stringify(bounded))
  listeners.get(url)?.forEach((listener) => listener())
}

export function clearSeenWatermarks(url: string) {
  localStorage.removeItem(key(url))
  listeners.get(url)?.forEach((listener) => listener())
}

function read(url: string) {
  const parsed = parse(localStorage.getItem(key(url)))
  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .slice(-MAX_SEEN_SESSIONS),
  )
}

function parse(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function snapshot(url: string) {
  return JSON.stringify(read(url))
}

function subscribe(url: string, listener: () => void) {
  const current = listeners.get(url) ?? new Set()
  current.add(listener)
  listeners.set(url, current)
  return () => {
    current.delete(listener)
    if (current.size === 0) listeners.delete(url)
  }
}

function key(url: string) {
  return `hena.seen.v1.${encodeServerSlug(url)}`
}

function emptySubscribe() {
  return () => {}
}
