import { streamSSE } from "hono/streaming"
import type { Context } from "hono"
import { requestedScopes } from "../collection/manifest"
import { error } from "../http/error"
import type { SyncDatabase } from "../storage/database"
import { createFrameFactory } from "./frame"
import type { StreamRegistry } from "../routes/streams"
import type { DeltaHub } from "./delta"
import type { OnlineRequestStore, VolatileCollection } from "../core/online-requests"
import { fitsPage, pages } from "./pages"

export function events(
  c: Context,
  database: SyncDatabase,
  streams: StreamRegistry,
  deltas: DeltaHub,
  online: OnlineRequestStore,
) {
  const existing = streams.get("local", c.req.param("streamId"))
  if (!existing) return error(c, 404, "not_found", "Stream not found")
  if (!existing.subscription) return error(c, 409, "conflict", "Subscribe before attaching")
  const resource = streams.attach("local", existing.id)
  if (!resource) return error(c, 404, "not_found", "Stream not found")
  const subscription = existing.subscription
  const frame = createFrameFactory({ database, streamId: resource.id, generation: resource.generation, subscription })

  c.header("Cache-Control", "no-store")
  c.header("X-Accel-Buffering", "no")
  return streamSSE(c, async (stream) => {
    const scopes = requestedScopes(
      subscription,
      database.collections.snapshot("locations", "").rows.map((row) => row.key),
    )
    const through = new Map<string, number>()
    const buffered: Array<{ scope: (typeof scopes)[number]; changes: readonly ReturnType<typeof database.changes.after>[number][] }> = []
    let live = false
    let volatileLive = false
    const pendingVolatile = new Set<string>()
    let writes = Promise.resolve()
    let queuedBytes = 0
    let ending = false
    const disconnected = Promise.withResolvers<void>()
    const disconnect = () => {
      ending = true
      disconnected.resolve()
    }
    streams.bind("local", resource.id, resource.generation, disconnect)
    stream.onAbort(disconnect)
    const enqueue = (event: string, value: Record<string, unknown>) => {
      if (ending) return
      const data = JSON.stringify(frame(value))
      const size = new TextEncoder().encode(data).byteLength
      if (queuedBytes + size > 4 * 1024 * 1024) {
        ending = true
        writes = writes
          .then(() => stream.writeSSE({
            event: "error",
            data: JSON.stringify(frame({ type: "error", code: "slow_consumer" })),
          }))
          .then(() => stream.close())
          .finally(disconnected.resolve)
        return
      }
      queuedBytes += size
      writes = writes
        .then(() => ending ? undefined : stream.writeSSE({ event, data }))
        .catch(disconnected.resolve)
        .finally(() => {
          queuedBytes -= size
        })
    }
    const unsubscribeDeltas = subscription.sessions.map((sessionID) =>
      deltas.subscribe(sessionID, (delta) => {
        enqueue("delta", { type: "delta", ...delta })
      }),
    )
    const publish = (scope: (typeof scopes)[number], changes: readonly ReturnType<typeof database.changes.after>[number][]) => {
      if (scope.collection === "locations") {
        changes.filter((change) => change.op === "insert" || change.op === "update").forEach((change) => addLocation(change.rowKey))
        changes.filter((change) => change.op === "delete").forEach((change) => removeLocation(change.rowKey))
      }
      if (!live) {
        buffered.push({ scope, changes })
        return
      }
      enqueueChanges(scope, changes)
    }
    const unsubscribe = new Map<string, () => void>()
    scopes.filter((scope) => !isVolatile(scope.collection)).forEach((scope) =>
      unsubscribe.set(scopeKey(scope), database.changes.subscribe(scope.collection, scope.scopeKey, (changes) => publish(scope, changes)))
    )
    function addLocation(locationKey: string) {
      if (!subscription.lists) return
      const settings = { collection: "settings" as const, scopeKey: locationKey }
      if (!scopes.some((scope) => scope.collection === settings.collection && scope.scopeKey === locationKey)) {
        scopes.push(settings)
        unsubscribe.set(
          scopeKey(settings),
          database.changes.subscribe(settings.collection, locationKey, (changes) => publish(settings, changes)),
        )
        enqueueSnapshot(settings)
      }
      for (const collection of ["agents", "models", "providers"] as const) {
        if (scopes.some((scope) => scope.collection === collection && scope.scopeKey === locationKey)) continue
        const scope = { collection, scopeKey: locationKey }
        scopes.push(scope)
        if (volatileLive) enqueueVolatile(scope)
        else pendingVolatile.add(`${collection}\u0000${locationKey}`)
      }
    }
    function removeLocation(locationKey: string) {
      if (!subscription.lists) return
      for (const collection of ["settings", "agents", "models", "providers"] as const) {
        const index = scopes.findIndex((scope) => scope.collection === collection && scope.scopeKey === locationKey)
        if (index === -1) continue
        const scope = scopes[index]
        scopes.splice(index, 1)
        unsubscribe.get(scopeKey(scope))?.()
        unsubscribe.delete(scopeKey(scope))
        pendingVolatile.delete(`${collection}\u0000${locationKey}`)
        through.delete(scopeKey(scope))
        buffered.splice(0, buffered.length, ...buffered.filter((item) => scopeKey(item.scope) !== scopeKey(scope)))
        enqueueEmptySnapshot(scope)
      }
    }
    const enqueueVolatile = (scope: { collection: VolatileCollection; scopeKey: string }) => {
      volatileFrames(scope).forEach((item) => enqueue(item.event, item.value))
    }
    const volatileFrames = (scope: { collection: VolatileCollection; scopeKey: string }) => {
      const snapshot = online.snapshot(scope.collection, scope.scopeKey)
      const snapshotId = crypto.randomUUID()
      const baseSeq = database.changes.current()
      return [
        {
          event: "snapshot.begin",
          value: { type: "snapshot.begin", scope, snapshotId, baseSeq, replace: true, sourceRevision: snapshot.revision },
        },
        ...pages(snapshot.rows).map((rows) => ({
          event: "snapshot.page",
          value: { type: "snapshot.page", scope, snapshotId, rows },
        })),
        {
          event: "snapshot.end",
          value: { type: "snapshot.end", scope, snapshotId, keyCount: snapshot.rows.length, throughSeq: baseSeq },
        },
      ]
    }
    const unsubscribeOnline = online.subscribe((collection, scopeKey) => {
      if (!scopes.some((scope) => scope.collection === collection && scope.scopeKey === scopeKey)) return
      if (!volatileLive) {
        pendingVolatile.add(`${collection}\u0000${scopeKey}`)
        return
      }
      enqueueVolatile({ collection, scopeKey })
    })
    const enqueueSnapshot = (scope: (typeof scopes)[number]) => {
      const snapshot = database.collections.snapshot(scope.collection, scope.scopeKey)
      through.set(scopeKey(scope), snapshot.throughSeq)
      const snapshotId = crypto.randomUUID()
      enqueue("snapshot.begin", { type: "snapshot.begin", scope, snapshotId, baseSeq: snapshot.throughSeq, replace: true })
      pages(snapshot.rows).forEach((rows) => enqueue("snapshot.page", { type: "snapshot.page", scope, snapshotId, rows }))
      enqueue("snapshot.end", { type: "snapshot.end", scope, snapshotId, keyCount: snapshot.rows.length, throughSeq: snapshot.throughSeq })
    }
    const enqueueEmptySnapshot = (scope: (typeof scopes)[number]) => {
      const snapshotId = crypto.randomUUID()
      const throughSeq = database.changes.current()
      enqueue("snapshot.begin", { type: "snapshot.begin", scope, snapshotId, baseSeq: throughSeq, replace: true })
      enqueue("snapshot.end", { type: "snapshot.end", scope, snapshotId, keyCount: 0, throughSeq })
    }
    const enqueueChanges = (scope: (typeof scopes)[number], changes: readonly ReturnType<typeof database.changes.after>[number][]) => {
      if (changes.length === 0) return
      const fromSeq = (through.get(scopeKey(scope)) ?? changes[0]!.seq - 1) + 1
      const throughSeq = changes.at(-1)!.seq
      through.set(scopeKey(scope), throughSeq)
      if (!fitsPage(changes)) {
        const last = changes.at(-1)!
        enqueue("rows", {
          type: "rows",
          scope,
          fromSeq,
          throughSeq,
          changes: [{ ...last, rowKey: "", op: "reset", row: null, rowRevision: undefined }],
        })
        enqueueSnapshot(scope)
        return
      }
      enqueue("rows", {
        type: "rows",
        scope,
        fromSeq,
        throughSeq,
        changes,
      })
    }
    enqueue("stream.ready", { type: "stream.ready" })
    for (const scope of scopes) {
      if (isVolatile(scope.collection)) {
        enqueueVolatile({ collection: scope.collection, scopeKey: scope.scopeKey })
        continue
      }
      const cursor = subscription.cursors[`${scope.collection}:${scope.scopeKey}`]
      if (
        cursor?.feedId === database.feed.get().feedId && cursor.seq >= database.feed.get().retainedFloor &&
        cursor.seq <= database.changes.current()
      ) {
        const changes = database.changes.after(scope.collection, scope.scopeKey, cursor.seq)
        through.set(scopeKey(scope), cursor.seq)
        groupTransactions(changes).forEach((transaction) => enqueueChanges(scope, transaction))
        continue
      }
      enqueueSnapshot(scope)
    }

    live = true
    volatileLive = true
    buffered
      .map(({ scope, changes }) => ({ scope, changes: changes.filter((change) => change.seq > (through.get(scopeKey(scope)) ?? 0)) }))
      .filter(({ changes }) => changes.length > 0)
      .sort((left, right) => left.changes[0]!.seq - right.changes[0]!.seq)
      .forEach(({ scope, changes }) => publish(scope, changes))
    pendingVolatile.forEach((key) => {
      const [collection, scopeKey] = key.split("\u0000") as [VolatileCollection, string]
      enqueueVolatile({ collection, scopeKey })
    })
    const heartbeat = setInterval(() => {
      enqueue("heartbeat", { type: "heartbeat", time: Date.now() })
    }, 15_000)
    await disconnected.promise
    clearInterval(heartbeat)
    streams.detach("local", resource.id, resource.generation)
    unsubscribe.forEach((remove) => remove())
    unsubscribeOnline()
    unsubscribeDeltas.forEach((remove) => remove())
    await writes
  })
}

function groupTransactions<Change extends { txid?: string }>(changes: readonly Change[]) {
  return changes.reduce<Change[][]>((transactions, change) => {
    const current = transactions.at(-1)
    if (current && change.txid !== undefined && current[0]!.txid === change.txid) current.push(change)
    else transactions.push([change])
    return transactions
  }, [])
}

function isVolatile(collection: string): collection is VolatileCollection {
  return collection === "permissions" || collection === "questions" || collection === "agents" ||
    collection === "models" || collection === "providers"
}

function scopeKey(scope: { collection: string; scopeKey: string }) {
  return `${scope.collection}\u0000${scope.scopeKey}`
}
