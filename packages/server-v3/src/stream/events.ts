import { streamSSE } from "hono/streaming"
import type { Context } from "hono"
import { requestedScopes } from "../collection/manifest"
import { error } from "../http/error"
import type { SyncDatabase } from "../storage/database"
import { createFrameFactory } from "./frame"
import type { StreamRegistry } from "../routes/streams"
import type { DeltaHub } from "./delta"
import type { OnlineRequestStore, VolatileCollection } from "../core/online-requests"
import { pages } from "./pages"

export function events(
  c: Context,
  database: SyncDatabase,
  streams: StreamRegistry,
  deltas: DeltaHub,
  online: OnlineRequestStore,
) {
  const resource = streams.attach("local", c.req.param("streamId"))
  if (!resource) return error(c, 404, "not_found", "Stream not found")
  if (!resource.subscription) return error(c, 409, "conflict", "Subscribe before attaching")
  const subscription = resource.subscription
  const frame = createFrameFactory({ database, streamId: resource.id, generation: resource.generation, subscription })

  c.header("Cache-Control", "no-store")
  c.header("X-Accel-Buffering", "no")
  return streamSSE(c, async (stream) => {
    const scopes = requestedScopes(
      subscription,
      database.collections.snapshot("locations", "").rows.map((row) => row.key),
    )
    const through = new Map<string, number>()
    const buffered: Array<{ scope: (typeof scopes)[number]; change: ReturnType<typeof database.changes.after>[number] }> = []
    let live = false
    let volatileLive = false
    const pendingVolatile = new Set<string>()
    let writes = Promise.resolve()
    let queuedBytes = 0
    let ending = false
    const disconnected = Promise.withResolvers<void>()
    stream.onAbort(disconnected.resolve)
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
        .then(() => stream.writeSSE({ event, data }))
        .finally(() => {
          queuedBytes -= size
        })
    }
    const unsubscribeDeltas = subscription.sessions.map((sessionID) =>
      deltas.subscribe(sessionID, (delta) => {
        enqueue("delta", { type: "delta", ...delta })
      }),
    )
    const publish = (scope: (typeof scopes)[number], change: ReturnType<typeof database.changes.after>[number]) => {
      if (!live) {
        buffered.push({ scope, change })
        return
      }
      enqueue("rows", { type: "rows", scope, fromSeq: change.seq, throughSeq: change.seq, changes: [change] })
    }
    const durableScopes = scopes.filter((scope) => !isVolatile(scope.collection))
    const unsubscribe = durableScopes.map((scope) =>
      database.changes.subscribe(scope.collection, scope.scopeKey, (change) => publish(scope, change)),
    )
    const writeVolatile = async (scope: { collection: VolatileCollection; scopeKey: string }) => {
      for (const item of volatileFrames(scope))
        await stream.writeSSE({ event: item.event, data: JSON.stringify(frame(item.value)) })
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
    await stream.writeSSE({ event: "stream.ready", data: JSON.stringify(frame({ type: "stream.ready" })) })
    for (const scope of scopes) {
      if (isVolatile(scope.collection)) {
        await writeVolatile({ collection: scope.collection, scopeKey: scope.scopeKey })
        continue
      }
      const cursor = subscription.cursors[`${scope.collection}:${scope.scopeKey}`]
      if (cursor?.feedId === database.feed.get().feedId && cursor.seq >= database.feed.get().retainedFloor) {
        const changes = database.changes.after(scope.collection, scope.scopeKey, cursor.seq)
        let fromSeq = cursor.seq + 1
        for (const changePage of pages(changes)) {
          const throughSeq = changePage.at(-1)!.seq
          await stream.writeSSE({
            event: "rows",
            data: JSON.stringify(frame({ type: "rows", scope, fromSeq, throughSeq, changes: changePage })),
          })
          fromSeq = throughSeq + 1
        }
        through.set(scopeKey(scope), changes.at(-1)?.seq ?? cursor.seq)
        continue
      }
      const snapshot = database.collections.snapshot(scope.collection, scope.scopeKey)
      through.set(scopeKey(scope), snapshot.throughSeq)
      const snapshotId = crypto.randomUUID()
      await stream.writeSSE({
        event: "snapshot.begin",
        data: JSON.stringify(frame({ type: "snapshot.begin", scope, snapshotId, baseSeq: snapshot.throughSeq, replace: true })),
      })
      for (const rows of pages(snapshot.rows))
        await stream.writeSSE({
          event: "snapshot.page",
          data: JSON.stringify(frame({ type: "snapshot.page", scope, snapshotId, rows })),
        })
      await stream.writeSSE({
        event: "snapshot.end",
        data: JSON.stringify(frame({ type: "snapshot.end", scope, snapshotId, keyCount: snapshot.rows.length, throughSeq: snapshot.throughSeq })),
      })
    }

    live = true
    volatileLive = true
    buffered
      .filter(({ scope, change }) => change.seq > (through.get(scopeKey(scope)) ?? 0))
      .sort((left, right) => left.change.seq - right.change.seq)
      .forEach(({ scope, change }) => publish(scope, change))
    pendingVolatile.forEach((key) => {
      const [collection, scopeKey] = key.split("\u0000") as [VolatileCollection, string]
      enqueueVolatile({ collection, scopeKey })
    })
    const heartbeat = setInterval(() => {
      enqueue("heartbeat", { type: "heartbeat", time: Date.now() })
    }, 15_000)
    await disconnected.promise
    clearInterval(heartbeat)
    streams.detach("local", resource.id)
    unsubscribe.forEach((remove) => remove())
    unsubscribeOnline()
    unsubscribeDeltas.forEach((remove) => remove())
    await writes
  })
}

function isVolatile(collection: string): collection is VolatileCollection {
  return collection === "permissions" || collection === "questions" || collection === "agents" ||
    collection === "models" || collection === "providers"
}

function scopeKey(scope: { collection: string; scopeKey: string }) {
  return `${scope.collection}\u0000${scope.scopeKey}`
}
