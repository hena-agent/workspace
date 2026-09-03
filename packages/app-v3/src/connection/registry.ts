import { decodeServerSlug, encodeServerSlug, normalizeServerUrl } from "@/lib/server-url"

const ConnectionsKey = "hena.connections.v1"
const TombstonesKey = "hena.tombstones.v1"
const MaxConnections = 100
const MaxTombstones = 500

export type ConnectionRecord = {
  url: string
  name: string
  addedAt: number
  own?: boolean
}

export type SlugResolution =
  | { kind: "registered"; url: string; connection: ConnectionRecord }
  | { kind: "tombstoned"; url: string }
  | { kind: "unknown"; url: string }
  | { kind: "malformed" }

export function createConnectionRegistry(input: { ownUrl?: string; storage?: Storage } = {}) {
  const storage = input.storage ?? localStorage
  const ownUrl = input.ownUrl && normalizeServerUrl(input.ownUrl)
  const readStoredConnections = () => decodeConnections(storage.getItem(ConnectionsKey))
  const readConnections = () => readStoredConnections().map((connection) => ({
    ...connection,
    ...(connection.url === ownUrl ? { own: true } : {}),
  }))
  const readTombstones = () => decodeStrings(storage.getItem(TombstonesKey))
  const writeConnections = (connections: ConnectionRecord[]) => storage.setItem(
    ConnectionsKey,
    JSON.stringify(connections.slice(0, MaxConnections).map(({ url, name, addedAt }) => ({ url, name, addedAt }))),
  )
  const writeTombstones = (tombstones: string[]) => storage.setItem(TombstonesKey, JSON.stringify(tombstones.slice(-MaxTombstones)))

  if (ownUrl) {
    const connections = readStoredConnections()
    if (!connections.some((connection) => connection.url === ownUrl)) {
      writeConnections([
        { url: ownUrl, name: new URL(ownUrl).host, addedAt: Date.now() },
        ...connections.slice(0, MaxConnections - 1),
      ])
    }
    const tombstones = readTombstones()
    if (tombstones.includes(ownUrl)) writeTombstones(tombstones.filter((url) => url !== ownUrl))
  }

  function add(value: string, name?: string) {
    const url = normalizeServerUrl(value)
    if (!url) return
    const existing = readConnections().find((connection) => connection.url === url)
    if (existing) {
      const tombstones = readTombstones()
      if (tombstones.includes(url)) writeTombstones(tombstones.filter((tombstone) => tombstone !== url))
      return existing
    }
    const connections = readConnections()
    if (connections.length >= MaxConnections) return
    const connection = {
      url,
      name: name?.trim() || new URL(url).host,
      addedAt: Date.now(),
      ...(url === ownUrl ? { own: true } : {}),
    }
    writeConnections([...connections, connection])
    writeTombstones(readTombstones().filter((tombstone) => tombstone !== url))
    return connection
  }

  function resolve(value: string) {
    const url = normalizeServerUrl(value)
    if (!url) return "malformed" as const
    if (readConnections().some((connection) => connection.url === url)) return "registered" as const
    if (readTombstones().includes(url)) return "tombstoned" as const
    return "unknown" as const
  }

  return {
    list: readConnections,
    add,
    remove(value: string) {
      const url = normalizeServerUrl(value)
      if (!url || url === ownUrl || !readConnections().some((connection) => connection.url === url)) return false
      writeConnections(readConnections().filter((connection) => connection.url !== url))
      writeTombstones(Array.from(new Set([...readTombstones(), url])))
      clearConnectionStorage(storage, url)
      return true
    },
    resolve,
    resolveSlug(slug: string | undefined): SlugResolution {
      if (!slug) return { kind: "malformed" }
      const url = decodeServerSlug(slug)
      if (!url) return { kind: "malformed" }
      const connection = readConnections().find((candidate) => candidate.url === url)
      if (connection) return { kind: "registered", url, connection }
      if (readTombstones().includes(url)) return { kind: "tombstoned", url }
      return { kind: "unknown", url }
    },
  }
}

function clearConnectionStorage(storage: Storage, url: string) {
  const slug = encodeServerSlug(url)
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key))
  const keysToRemove = keys.filter((key) =>
    key === `hena.recent.v1.${slug}` ||
    key === `hena.drafts.v1.${slug}` ||
    key === `hena.project-order.v1.${slug}` ||
    key.startsWith(`hena.draft.v1.${slug}.`),
  )
  keysToRemove.forEach((key) => storage.removeItem(key))
}

function decodeConnections(value: string | null): ConnectionRecord[] {
  if (!value) return []
  try {
    const decoded = JSON.parse(value)
    if (!Array.isArray(decoded)) return []
    return decoded.flatMap((item) => {
      if (typeof item !== "object" || item === null || typeof item.url !== "string" || typeof item.addedAt !== "number") return []
      const url = normalizeServerUrl(item.url)
      if (!url || url !== item.url) return []
      return [{ url, name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : new URL(url).host, addedAt: item.addedAt }]
    }).slice(0, MaxConnections)
  } catch {
    return []
  }
}

function decodeStrings(value: string | null): string[] {
  if (!value) return []
  try {
    const decoded = JSON.parse(value)
    if (!Array.isArray(decoded)) return []
    return Array.from(new Set(decoded.flatMap((item) => {
      if (typeof item !== "string") return []
      const url = normalizeServerUrl(item)
      return url === item ? [url] : []
    }))).slice(-MaxTombstones)
  } catch {
    return []
  }
}
