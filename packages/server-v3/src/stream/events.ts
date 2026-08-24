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
import type { Database } from "bun:sqlite"

type StoredChange = {
  seq: number
  collection: string
  scope_key: string
  row_key: string
  op: Change["op"]
  row: string | null
  row_revision: string | null
  txid: string | null
  runtime_id: string
  created_at: number
}

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
    let writes = Promise.resolve()
    let unsubscribe = () => {}
    let unsubscribeOnline = () => {}
    let unsubscribeDeltas: Array<() => void> = []
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      if (heartbeat) clearInterval(heartbeat)
      streams.detach("local", resource.id, resource.generation)
      unsubscribe()
      unsubscribeOnline()
      unsubscribeDeltas.forEach((remove) => remove())
      await writes
    }
    await using _ = { [Symbol.asyncDispose]: dispose }
    const scopes = requestedScopes(
      subscription,
      database.collections.snapshot("locations", "").rows.map((row) => row.key),
    )
    const through = new Map<string, number>()
    const buffered: Array<readonly Change[]> = []
    const replayCursors = new Map<string, number>()
    let live = false
    let volatileLive = false
    let deltaLive = false
    const pendingVolatile = new Set<string>()
    const pendingDeltas: Delta[] = []
    type Recovery = { scope: (typeof scopes)[number]; fromSeq: number; throughSeq: number; changes: Change[] }
    const pendingRecoveries = new Map<string, Recovery>()
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
      if (ending) return
      ending = true
      void stream.writeSSE({
        event: "error",
        data: JSON.stringify(frame({ type: "error", code: "slow_consumer" })),
      })
      stream.abort()
      disconnected.resolve()
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
    unsubscribeDeltas = Array.from(new Set(subscription.sessions), (sessionID) =>
      deltas.subscribe(sessionID, (delta) => {
        if (!deltaLive) {
          if (!reserveBuffer(delta)) return
          pendingDeltas.push(delta)
          return
        }
        enqueue("delta", { type: "delta", ...delta })
      }),
    )
    const updateLocations = (changes: readonly Change[]) => {
      changes
        .filter((change) => change.collection === "locations" && (change.op === "insert" || change.op === "update"))
        .forEach((change) => addLocation(change.rowKey))
      changes
        .filter((change) => change.collection === "locations" && change.op === "delete")
        .forEach((change) => removeLocation(change.rowKey))
    }
    const publish = (changes: readonly Change[]) => {
      updateLocations(changes)
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
    unsubscribe = database.changes.subscribeTransactions(publish)
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
        pendingRecoveries.delete(scopeKey(scope))
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
        ...pages(snapshot.rows.map((row) => ({ ...row, key: wireKey(scope.collection, row.key) }))).map((rows) => ({
          event: "snapshot.page",
          value: { type: "snapshot.page", scope, snapshotId, rows },
        })),
        {
          event: "snapshot.end",
          value: { type: "snapshot.end", scope, snapshotId, keyCount: snapshot.rows.length, throughSeq: baseSeq },
        },
      ]
    }
    unsubscribeOnline = online.subscribe((collection, scopeKey) => {
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
        ...pages(snapshot.rows.map((row) => ({ ...row, key: wireKey(scope.collection, row.key) }))).map((rows) => ({
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
    const writeSnapshot = async (scope: (typeof scopes)[number], source: Database, throughSeq: number) => {
      const snapshotId = crypto.randomUUID()
      let keyCount = 0
      let after = ""
      through.set(scopeKey(scope), throughSeq)
      await stream.writeSSE({
        event: "snapshot.begin",
        data: JSON.stringify(frame({ type: "snapshot.begin", scope, snapshotId, baseSeq: throughSeq, replace: true })),
      })
      const query = source.query<
        { row_key: string; row: string; row_revision: string },
        [string, string, string]
      >(`
        SELECT row_key, row, row_revision FROM collection_row
        WHERE collection = ? AND scope_key = ? AND row_key > ?
        ORDER BY row_key LIMIT 4
      `)
      while (!ending) {
        const rows = query.all(scope.collection, scope.scopeKey, after)
        if (rows.length === 0) break
        after = rows.at(-1)!.row_key
        const projected = rows.map((row) => ({
          key: wireKey(scope.collection, row.row_key),
          row: JSON.parse(row.row),
          revision: row.row_revision,
        }))
        keyCount += projected.length
        for (const page of pages(projected))
          await stream.writeSSE({
            event: "snapshot.page",
            data: JSON.stringify(frame({ type: "snapshot.page", scope, snapshotId, rows: page })),
          })
      }
      if (ending) return
      await stream.writeSSE({
        event: "snapshot.end",
        data: JSON.stringify(frame({ type: "snapshot.end", scope, snapshotId, keyCount, throughSeq })),
      })
    }
    const writeRecoveries = async (
      recoveries: readonly Recovery[],
      source: Database,
      throughSeq: number,
    ) => {
      await stream.writeSSE({
        event: "rows",
        data: JSON.stringify(
          frame({
            type: "rows",
            affectedScopes: recoveries.map((recovery) => recovery.scope),
            fromSeq: Math.min(...recoveries.map((recovery) => recovery.fromSeq)),
            throughSeq,
            changes: recoveries.flatMap((recovery) => recovery.changes.map((change) => ({ ...change, seq: throughSeq }))),
          }),
        ),
      })
      for (const recovery of recoveries) {
        if (ending) return
        await writeSnapshot(recovery.scope, source, throughSeq)
      }
    }
    const scheduleRecoveries = (
      incoming: ReadonlyArray<{
        scope: (typeof scopes)[number]
        fromSeq: number
        throughSeq: number
        change: Change
      }>,
    ) => {
      incoming.forEach((recovery) => {
        const pending = pendingRecoveries.get(scopeKey(recovery.scope))
        pendingRecoveries.set(scopeKey(recovery.scope), {
          scope: recovery.scope,
          fromSeq: pending ? Math.min(pending.fromSeq, recovery.fromSeq) : recovery.fromSeq,
          throughSeq: recovery.throughSeq,
          changes: [...(pending?.changes ?? []), recovery.change],
        })
      })
      if (snapshotsScheduled) return
      snapshotsScheduled = true
      writes = writes
        .then(async () => {
          try {
            while (!ending && pendingRecoveries.size > 0) {
              const recoveries = Array.from(pendingRecoveries.values())
              pendingRecoveries.clear()
              const { Database } = await import("bun:sqlite")
              const source = new Database(database.raw.filename, { readonly: true })
              source.exec("BEGIN")
              try {
                const throughSeq = source
                  .query<{ seq: number }, []>("SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change")
                  .get()!.seq
                await writeRecoveries(recoveries, source, throughSeq)
              } finally {
                source.exec("COMMIT")
                source.close()
              }
            }
          } finally {
            snapshotsScheduled = false
          }
        })
        .catch(disconnected.resolve)
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
      if (!fitsPage(changes) || changes.some((change) => change.op === "reset")) {
        scheduleRecoveries(
          affectedScopes.map((scope) => {
            const last = changes.findLast(
              (change) => change.collection === scope.collection && change.scopeKey === scope.scopeKey,
            )!
            return {
              scope,
              fromSeq,
              throughSeq,
              change: { ...last, rowKey: "", op: "reset", row: null, rowRevision: undefined },
            }
          }),
        )
        return
      }
      enqueue("rows", {
        type: "rows",
        affectedScopes,
        fromSeq,
        throughSeq,
        changes: changes.map((change) => ({ ...change, rowKey: wireKey(change.collection, change.rowKey) })),
      })
    }
    enqueue("stream.ready", { type: "stream.ready" })
    await writes
    const { Database } = await import("bun:sqlite")
    const snapshotDatabase = new Database(database.raw.filename, { readonly: true })
    snapshotDatabase.exec("BEGIN")
    try {
      const feed = snapshotDatabase
        .query<{ feed_id: string; retained_floor: number }, []>(
          "SELECT feed_id, retained_floor FROM collection_feed WHERE id = 1",
        )
        .get()!
      const baseSeq = Math.max(
        snapshotDatabase.query<{ seq: number }, []>("SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change").get()!
          .seq,
        feed.retained_floor,
      )
      // Collection rows are individually bounded below 1 MiB, so four rows cap each decoded read near 4 MiB.
      const snapshotRows = snapshotDatabase.query<
        { row_key: string; row: string; row_revision: string },
        [string, string, string]
      >(`
        SELECT row_key, row, row_revision FROM collection_row
        WHERE collection = ? AND scope_key = ? AND row_key > ?
        ORDER BY row_key LIMIT 4
      `)
      const replayNext = snapshotDatabase.query<StoredChange, [number, number]>(`
        SELECT seq, collection, scope_key, row_key, op, row, row_revision, txid, runtime_id, created_at
        FROM collection_change
        WHERE seq > ? AND seq <= ?
        ORDER BY seq LIMIT 1
      `)
      const replayTransactionEnd = snapshotDatabase.query<{ seq: number }, [number, string]>(`
        SELECT COALESCE(
          (SELECT seq - 1 FROM collection_change WHERE seq > ? AND txid IS NOT ? ORDER BY seq LIMIT 1),
          (SELECT MAX(seq) FROM collection_change)
        ) AS seq
      `)
      const replayTransactionSize = snapshotDatabase.query<{ bytes: number }, [number, number]>(`
        SELECT COALESCE(SUM(LENGTH(CAST(collection AS BLOB)) + LENGTH(CAST(scope_key AS BLOB)) +
          LENGTH(CAST(row_key AS BLOB)) + COALESCE(LENGTH(CAST(row AS BLOB)), 0) + 128), 0) AS bytes
        FROM collection_change
        WHERE seq >= ? AND seq <= ?
      `)
      const replayTransaction = snapshotDatabase.query<StoredChange, [number, number]>(`
        SELECT seq, collection, scope_key, row_key, op, row, row_revision, txid, runtime_id, created_at
        FROM collection_change
        WHERE seq >= ? AND seq <= ?
        ORDER BY seq
      `)
      const replayTransactionScopes = snapshotDatabase.query<StoredChange, [number, number, number, number]>(`
        SELECT seq, collection, scope_key, '' AS row_key, 'reset' AS op, NULL AS row, NULL AS row_revision,
          txid, runtime_id, created_at
        FROM collection_change
        WHERE seq >= ? AND seq <= ? AND (collection || char(0) || scope_key || char(0) || seq) IN (
          SELECT collection || char(0) || scope_key || char(0) || MAX(seq)
          FROM collection_change
          WHERE seq >= ? AND seq <= ?
          GROUP BY collection, scope_key
        )
        ORDER BY seq
      `)

      for (const scope of scopes) {
        if (!scopes.some((current) => scopeKey(current) === scopeKey(scope))) continue
        if (isVolatile(scope.collection)) {
          await writeFrames(volatileFrames({ collection: scope.collection, scopeKey: scope.scopeKey }))
          continue
        }
        const cursor = subscription.cursors[`${scope.collection}:${scope.scopeKey}`]
        if (cursor?.feedId === feed.feed_id && cursor.seq >= feed.retained_floor && cursor.seq <= baseSeq) {
          through.set(scopeKey(scope), cursor.seq)
          replayCursors.set(scopeKey(scope), cursor.seq)
          continue
        }

        through.set(scopeKey(scope), baseSeq)
        const snapshotId = crypto.randomUUID()
        await writeFrames([
          {
            event: "snapshot.begin",
            value: { type: "snapshot.begin", scope, snapshotId, baseSeq, replace: true },
          },
        ])
        let keyCount = 0
        let after = ""
        while (true) {
          const rows = snapshotRows.all(scope.collection, scope.scopeKey, after)
          if (rows.length === 0) break
          if (!scopes.some((current) => scopeKey(current) === scopeKey(scope))) break
          const projected = rows.map((row) => ({
            key: wireKey(scope.collection, row.row_key),
            row: JSON.parse(row.row),
            revision: row.row_revision,
          }))
          keyCount += projected.length
          after = rows.at(-1)!.row_key
          await writeFrames(
            pages(projected).map((page) => ({
              event: "snapshot.page",
              value: { type: "snapshot.page", scope, snapshotId, rows: page },
            })),
          )
        }
        if (!scopes.some((current) => scopeKey(current) === scopeKey(scope))) continue
        await writeFrames([
          {
            event: "snapshot.end",
            value: { type: "snapshot.end", scope, snapshotId, keyCount, throughSeq: baseSeq },
          },
        ])
      }

      const replayFrom = Math.min(...replayCursors.values(), baseSeq)
      let replayAfter = replayFrom
      while (replayAfter < baseSeq) {
        const next = replayNext.get(replayAfter, baseSeq)
        if (!next) break
        const throughSeq = next.txid === null ? next.seq : replayTransactionEnd.get(next.seq, next.txid)!.seq
        const oversized =
          next.txid !== null && replayTransactionSize.get(next.seq, throughSeq)!.bytes > 4 * 1024 * 1024
        const pending = (
          oversized
            ? replayTransactionScopes.all(next.seq, throughSeq, next.seq, throughSeq)
            : next.txid === null
              ? [next]
              : replayTransaction.all(next.seq, throughSeq)
        )
          .filter((row) => {
            const cursor = replayCursors.get(`${row.collection}\u0000${row.scope_key}`)
            return cursor !== undefined && row.seq > cursor
          })
          .map(storedChange)
        replayAfter = throughSeq
        if (pending.length === 0) continue
        updateLocations(pending)
        if (oversized || !fitsPage(pending) || pending.some((change) => change.op === "reset")) {
          const affectedScopes = Array.from(
            new Map(
              pending.map((change) => {
                const scope = { collection: change.collection, scopeKey: change.scopeKey }
                return [scopeKey(scope), scope]
              }),
            ).values(),
          )
          await writeRecoveries(
            affectedScopes.map((scope) => ({
              scope,
              fromSeq: next.seq,
              throughSeq,
              changes: [
                {
                  ...pending.findLast(
                    (change) => change.collection === scope.collection && change.scopeKey === scope.scopeKey,
                  )!,
                  rowKey: "",
                  op: "reset",
                  row: null,
                  rowRevision: undefined,
                },
              ],
            })),
            snapshotDatabase,
            baseSeq,
          )
        } else {
          enqueueChanges(pending)
          await writes
        }
      }
    } finally {
      snapshotDatabase.exec("COMMIT")
      snapshotDatabase.close()
    }

    live = true
    volatileLive = true
    bufferedBytes = 0
    buffered
      .filter((changes) => changes.some((change) => change.seq > (through.get(scopeKey(change)) ?? 0)))
      .sort((left, right) => left[0].seq - right[0].seq)
      .forEach(enqueueChanges)
    buffered.length = 0
    pendingDeltas.forEach((delta) => enqueue("delta", { type: "delta", ...delta }))
    pendingDeltas.length = 0
    deltaLive = true
    pendingVolatile.forEach((key) => {
      const [collection, scopeKey] = key.split("\u0000") as [VolatileCollection, string]
      enqueueVolatile({ collection, scopeKey })
    })
    pendingVolatile.clear()
    heartbeat = setInterval(() => {
      enqueue("heartbeat", { type: "heartbeat", time: Date.now() })
    }, 15_000)
    await disconnected.promise
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

function storedChange(row: StoredChange): Change {
  return {
    seq: row.seq,
    collection: row.collection,
    scopeKey: row.scope_key,
    rowKey: row.row_key,
    op: row.op,
    row: row.row === null ? null : JSON.parse(row.row),
    rowRevision: row.row_revision ?? undefined,
    txid: row.txid ?? undefined,
    runtimeId: row.runtime_id,
    createdAt: row.created_at,
  }
}

function wireKey(collection: string, key: string) {
  const length = collection === "parts" ? 3 : collection === "models" ? 2 : undefined
  if (length === undefined || !key.startsWith("[")) return key
  const decoded = JSON.parse(key) as unknown
  return Array.isArray(decoded) && decoded.length === length && decoded.every((item) => typeof item === "string")
    ? decoded
    : key
}
