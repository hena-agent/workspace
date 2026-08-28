export type DraftSelection = { start: number; end: number }
export type DraftDelivery = "steer" | "queue"
export type DraftBody = {
  text: string
  selection: DraftSelection
  agentID?: string
  modelID?: string
  delivery: DraftDelivery
  droppedAttachments: number
  error?: string
}

type DraftIndexEntry = { key: string; route: string; updatedAt: number }
type DraftStore = { version: 2; index: DraftIndexEntry[]; bodies: Record<string, DraftBody> }

const MAX_DRAFTS = 100
const MAX_DRAFT_TEXT = 100_000

export function loadDraft(url: string, key: string, storage: Storage = localStorage) {
  return load(url, storage).bodies[key]
}

export function saveDraft(url: string, key: string, route: string, body: DraftBody, storage: Storage = localStorage) {
  const current = load(url, storage)
  const updatedAt = Date.now()
  const nextBody = normalizeBody(body)
  const index = [...current.index.filter((entry) => entry.key !== key), { key, route, updatedAt }].slice(-MAX_DRAFTS)
  const retained = new Set(index.map((entry) => entry.key))
  const bodies = Object.fromEntries(
    Object.entries({ ...current.bodies, [key]: nextBody }).filter(([draftKey]) => retained.has(draftKey)),
  )
  storage.setItem(storageKey(url), JSON.stringify({ version: 2, index, bodies } satisfies DraftStore))
  return nextBody
}

export function removeDraft(url: string, key: string, storage: Storage = localStorage) {
  const current = load(url, storage)
  const bodies = { ...current.bodies }
  delete bodies[key]
  storage.setItem(storageKey(url), JSON.stringify({
    version: 2,
    index: current.index.filter((entry) => entry.key !== key),
    bodies,
  } satisfies DraftStore))
}

export function listDrafts(url: string, storage: Storage = localStorage) {
  return load(url, storage).index
}

function load(url: string, storage: Storage): DraftStore {
  const value = parse(storage.getItem(storageKey(url)))
  if (record(value).version === 2) return versionTwo(value)
  if (record(value).version === 1) return migrateVersionOne(value)
  return { version: 2, index: [], bodies: {} }
}

function storageKey(url: string) {
  return `hena.drafts.v1.${encodeServerSlug(url)}`
}

function versionTwo(value: unknown): DraftStore {
  const source = record(value)
  const bodies = Object.fromEntries(
    Object.entries(record(source.bodies)).map(([key, body]) => [key, normalizeBody(record(body))]),
  )
  const candidates = array(source.index).flatMap((entry) => {
    const item = record(entry)
    return typeof item.key === "string" && typeof item.route === "string" && typeof item.updatedAt === "number"
      ? [{ key: item.key, route: item.route, updatedAt: item.updatedAt }]
      : []
  })
  const available = candidates.filter((entry) => bodies[entry.key])
  const index = available.slice(-MAX_DRAFTS)
  return { version: 2, index, bodies: Object.fromEntries(Object.entries(bodies).filter(([key]) => index.some((entry) => entry.key === key))) }
}

function migrateVersionOne(value: unknown): DraftStore {
  const source = record(value)
  const drafts = record(source.drafts)
  const entries = Object.entries(drafts).slice(-MAX_DRAFTS).map(([key, body], index) => {
    const item = record(body)
    return {
      index: { key, route: typeof item.route === "string" ? item.route : key, updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : index },
      body: normalizeBody(item),
    }
  })
  return {
    version: 2,
    index: entries.map((entry) => entry.index),
    bodies: Object.fromEntries(entries.map((entry) => [entry.index.key, entry.body])),
  }
}

function normalizeBody(value: Partial<DraftBody> | Record<string, unknown>): DraftBody {
  const selection = record(value.selection)
  const text = typeof value.text === "string" ? value.text.slice(0, MAX_DRAFT_TEXT) : ""
  return {
    text,
    selection: {
      start: boundedInteger(selection.start, text.length),
      end: boundedInteger(selection.end, text.length),
    },
    ...(typeof value.agentID === "string" ? { agentID: value.agentID } : {}),
    ...(typeof value.modelID === "string" ? { modelID: value.modelID } : {}),
    delivery: value.delivery === "queue" ? "queue" : "steer",
    droppedAttachments: boundedInteger(value.droppedAttachments, 1_000),
    ...(typeof value.error === "string" ? { error: value.error.slice(0, 1_000) } : {}),
  }
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
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function boundedInteger(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(0, Math.min(value, maximum)) : 0
}
import { encodeServerSlug } from "@/lib/server-url"
