import { streamSSE } from "hono/streaming"
import type { Context } from "hono"
import { requestedScopes } from "../collection/manifest"
import { error } from "../http/error"
import type { SyncDatabase } from "../storage/database"
import { createFrameFactory } from "./frame"
import type { StreamRegistry } from "../routes/streams"
import type { Delta, DeltaHub } from "./delta"
import type { OnlineRequestStore, VolatileCollection } from "../core/online-requests"
import { fitsPage, pages } from "./pages"
import type { Change } from "../storage/changes"

export function events(
  c: Context,
  database: SyncDatabase,
  streams: StreamRegistry,
  deltas: DeltaHub,
  online: OnlineRequestStore,
) {
  const streamID = c.req.param("streamId")
  if (!streamID) return error(c, 404, "not_found", "Stream not found")
  const existing = streams.get("local", streamID)
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
    const buffered: Array<readonly Change[]> = []
    const replay = new Map<number, Change>()
    let live = false
    let volatileLive = false
    let deltaLive = false
    const pendingVolatile = new Set<string>()
    const pendingDeltas: Delta[] = []
    const pendingSnapshots = new Map<string, (typeof scopes)[number]>()
    let writes = Promise.resolve()
    let snapshotsScheduled = false
    let queuedBytes = 0
    let bufferedBytes = 0
    let ending = false
    const disconnected = Promise.withResolvers<void>()
    const disconnect = () => {
      ending = true
      disconnected.resolve()
    }
    streams.bind("local", resource.id, resource.generation, disconnect)
    stream.onAbort(disconnect)
    const slowConsumer = () => {
      ending = true
      writes = writes
        .then(() =>
          stream.writeSSE({
            event: "error",
            data: JSON.stringify(frame({ type: "error", code: "slow_consumer" })),
          }),
        )
        .then(() => stream.close())
        .finally(disconnected.resolve)
    }
    const reserveBuffer = (value: unknown) => {
      const size = new TextEncoder().encode(JSON.stringify(value)).byteLength
      if (queuedBytes + bufferedBytes + size > 4 * 1024 * 1024) {
        slowConsumer()
        return false
      }
      bufferedBytes += size
      return true
    }
    const enqueue = (event: string, value: Record<string, unknown>) => {
      if (ending) return
      const data = JSON.stringify(frame(value))
      const size = new TextEncoder().encode(data).byteLength
      if (queuedBytes + bufferedBytes + size > 4 * 1024 * 1024) {
        slowConsumer()
        return
      }
      queuedBytes += size
      writes = writes
        .then(() => (ending ? undefined : stream.writeSSE({ event, data })))
        .catch(disconnected.resolve)
        .finally(() => {
          queuedBytes -= size
        })
    }
    const unsubscribeDeltas = Array.from(new Set(subscription.sessions), (sessionID) =>
      deltas.subscribe(sessionID, (delta) => {
        if (!deltaLive) {
          if (!reserveBuffer(delta)) return
          pendingDeltas.push(delta)
          return
        }
        enqueue("delta", { type: "delta", ...delta })
      }),
    )
    const publish = (changes: readonly Change[]) => {
      changes
        .filter((change) => change.collection === "locations" && (change.op === "insert" || change.op === "update"))
        .forEach((change) => addLocation(change.rowKey))
      changes
        .filter((change) => change.collection === "locations" && change.op === "delete")
        .forEach((change) => removeLocation(change.rowKey))
      const visible = changes.filter((change) =>
        scopes.some((scope) => scope.collection === change.collection && scope.scopeKey === change.scopeKey),
      )
      if (visible.length === 0) return
      if (!live) {
        if (!reserveBuffer(visible)) return
        buffered.push(visible)
        return
      }
      enqueueChanges(visible)
    }
    const unsubscribe = database.changes.subscribeTransactions(publish)
    function addLocation(locationKey: string) {
      if (!subscription.lists) return
      const settings = { collection: "settings" as const, scopeKey: locationKey }
      if (!scopes.some((scope) => scope.collection === settings.collection && scope.scopeKey === locationKey)) {
        scopes.push(settings)
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
        pendingVolatile.delete(`${collection}\u0000${locationKey}`)
        pendingSnapshots.delete(scopeKey(scope))
        through.delete(scopeKey(scope))
        buffered.splice(
          0,
          buffered.length,
          ...buffered
            .map((changes) => changes.filter((change) => scopeKey(change) !== scopeKey(scope)))
            .filter((changes) => changes.length > 0),
        )
        enqueueEmptySnapshot(scope)
      }
      for (const collection of ["agents", "models", "providers"] as const) online.remove(collection, locationKey)
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
          value: {
            type: "snapshot.begin",
            scope,
            snapshotId,
            baseSeq,
            replace: true,
            sourceRevision: snapshot.revision,
          },
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
    const snapshotFrames = (
      scope: (typeof scopes)[number],
      snapshot = database.collections.snapshot(scope.collection, scope.scopeKey),
    ) => {
      through.set(scopeKey(scope), snapshot.throughSeq)
      const snapshotId = crypto.randomUUID()
      return [
        {
          event: "snapshot.begin",
          value: { type: "snapshot.begin", scope, snapshotId, baseSeq: snapshot.throughSeq, replace: true },
        },
        ...pages(snapshot.rows).map((rows) => ({
          event: "snapshot.page",
          value: { type: "snapshot.page", scope, snapshotId, rows },
        })),
        {
          event: "snapshot.end",
          value: {
            type: "snapshot.end",
            scope,
            snapshotId,
            keyCount: snapshot.rows.length,
            throughSeq: snapshot.throughSeq,
          },
        },
      ]
    }
    const enqueueSnapshot = (scope: (typeof scopes)[number]) => {
      snapshotFrames(scope).forEach((item) => enqueue(item.event, item.value))
    }
    const writeFrames = async (frames: ReadonlyArray<{ event: string; value: Record<string, unknown> }>) => {
      for (const item of frames) {
        enqueue(item.event, item.value)
        await writes
      }
    }
    const scheduleSnapshots = (incoming: ReadonlyArray<(typeof scopes)[number]>) => {
      incoming.forEach((scope) => pendingSnapshots.set(scopeKey(scope), scope))
      if (snapshotsScheduled) return
      snapshotsScheduled = true
      writes = writes
        .then(async () => {
          while (!ending && pendingSnapshots.size > 0) {
            const scope = pendingSnapshots.values().next().value
            if (!scope) return
            pendingSnapshots.delete(scopeKey(scope))
            for (const item of snapshotFrames(scope)) {
              if (ending) return
              await stream.writeSSE({ event: item.event, data: JSON.stringify(frame(item.value)) })
            }
          }
        })
        .catch(disconnected.resolve)
        .finally(() => {
          snapshotsScheduled = false
          if (pendingSnapshots.size > 0) scheduleSnapshots([])
        })
    }
    const enqueueEmptySnapshot = (scope: (typeof scopes)[number]) => {
      const snapshotId = crypto.randomUUID()
      const throughSeq = database.changes.current()
      enqueue("snapshot.begin", { type: "snapshot.begin", scope, snapshotId, baseSeq: throughSeq, replace: true })
      enqueue("snapshot.end", { type: "snapshot.end", scope, snapshotId, keyCount: 0, throughSeq })
    }
    const enqueueChanges = (changes: readonly Change[]) => {
      if (changes.length === 0) return
      const affectedScopes = Array.from(
        new Map(
          changes.map((change) => {
            const scope = { collection: change.collection, scopeKey: change.scopeKey }
            return [scopeKey(scope), scope]
          }),
        ).values(),
      )
      const fromSeq = changes[0].seq
      const throughSeq = changes.at(-1)!.seq
      affectedScopes.forEach((scope) => through.set(scopeKey(scope), throughSeq))
      if (!fitsPage(changes)) {
        enqueue("rows", {
          type: "rows",
          affectedScopes,
          fromSeq,
          throughSeq,
          changes: affectedScopes.map((scope) => {
            const last = changes.findLast(
              (change) => change.collection === scope.collection && change.scopeKey === scope.scopeKey,
            )!
            return { ...last, rowKey: "", op: "reset", row: null, rowRevision: undefined }
          }),
        })
        scheduleSnapshots(affectedScopes)
        return
      }
      enqueue("rows", {
        type: "rows",
        affectedScopes,
        fromSeq,
        throughSeq,
        changes,
      })
    }
    enqueue("stream.ready", { type: "stream.ready" })
    await writes
    const initial = database.raw.transaction(() => {
      const feed = database.feed.get()
      const baseSeq = database.changes.current()
      return scopes.map((scope) => {
        if (isVolatile(scope.collection)) return { scope }
        const cursor = subscription.cursors[`${scope.collection}:${scope.scopeKey}`]
        if (cursor?.feedId === feed.feedId && cursor.seq >= feed.retainedFloor && cursor.seq <= baseSeq) {
          return {
            scope,
            cursor,
            changes: database.changes
              .after(scope.collection, scope.scopeKey, cursor.seq)
              .filter((change) => change.seq <= baseSeq),
          }
        }
        return {
          scope,
          snapshot: {
            ...database.collections.snapshot(scope.collection, scope.scopeKey),
            throughSeq: baseSeq,
          },
        }
      })
    })()
    for (const item of initial) {
      if (!scopes.some((scope) => scopeKey(scope) === scopeKey(item.scope))) continue
      if (isVolatile(item.scope.collection)) {
        await writeFrames(volatileFrames({ collection: item.scope.collection, scopeKey: item.scope.scopeKey }))
        continue
      }
      if (item.cursor) {
        through.set(scopeKey(item.scope), item.cursor.seq)
        item.changes?.forEach((change) => replay.set(change.seq, change))
        continue
      }
      await writeFrames(snapshotFrames(item.scope, item.snapshot))
    }

    for (const changes of groupTransactions(Array.from(replay.values()).sort((left, right) => left.seq - right.seq))) {
      enqueueChanges(changes)
      await writes
    }

    live = true
    volatileLive = true
    bufferedBytes = 0
    buffered
      .filter((changes) => changes.some((change) => change.seq > (through.get(scopeKey(change)) ?? 0)))
      .sort((left, right) => left[0].seq - right[0].seq)
      .forEach(enqueueChanges)
    pendingDeltas.forEach((delta) => enqueue("delta", { type: "delta", ...delta }))
    deltaLive = true
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
    unsubscribe()
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
  return (
    collection === "permissions" ||
    collection === "questions" ||
    collection === "agents" ||
    collection === "models" ||
    collection === "providers"
  )
}

function scopeKey(scope: { collection: string; scopeKey: string }) {
  return `${scope.collection}\u0000${scope.scopeKey}`
}
