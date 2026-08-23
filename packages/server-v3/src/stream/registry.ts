export type Cursor = { feedId: string; seq: number }
export type Subscription = {
  revision: number
  lists: boolean
  sessions: readonly string[]
  cursors: Readonly<Record<string, Cursor>>
}

type StreamResource = {
  id: string
  principal: string
  generation: number
  expiresAt: number
  subscription?: Subscription
}

export class StreamRevisionConflict extends Error {
  readonly code = "subscription_revision_conflict"
}

export function createStreamRegistry(config: { graceMs: number; now?: () => number }) {
  const resources = new Map<string, StreamResource>()
  const now = config.now ?? Date.now

  const owned = (principal: string, id: string) => {
    const resource = resources.get(id)
    if (resource && resource.expiresAt < now()) {
      resources.delete(id)
      return undefined
    }
    return resource?.principal === principal ? resource : undefined
  }

  return {
    create(principal: string) {
      const resource: StreamResource = {
        id: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
        principal,
        generation: 0,
        expiresAt: now() + config.graceMs,
      }
      resources.set(resource.id, resource)
      return resource
    },
    get(principal: string, id: string) {
      return owned(principal, id)
    },
    subscribe(principal: string, id: string, subscription: Subscription) {
      const resource = owned(principal, id)
      if (!resource) return undefined
      if (resource.subscription && subscription.revision <= resource.subscription.revision) throw new StreamRevisionConflict()
      resource.subscription = subscription
      return subscription
    },
    attach(principal: string, id: string) {
      const resource = owned(principal, id)
      if (!resource) return undefined
      resource.generation++
      resource.expiresAt = Number.POSITIVE_INFINITY
      return resource
    },
    detach(principal: string, id: string) {
      const resource = owned(principal, id)
      if (!resource) return
      resource.expiresAt = now() + config.graceMs
    },
    delete(principal: string, id: string) {
      const resource = owned(principal, id)
      if (!resource) return false
      return resources.delete(id)
    },
  }
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}
