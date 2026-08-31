import { createCollection } from "@tanstack/db"

type Row = Record<string, unknown>
type StoredRow = { __key: string; __revision?: string; row: Row }
type ScopeControl = {
  begin: () => void
  write: (change:
    | { type: "insert"; value: StoredRow }
    | { type: "update"; key: string; value: StoredRow }
    | { type: "delete"; key: string }) => void
  commit: () => void
  markReady: () => void
}
export type DeltaIdentity = {
  sessionId: string
  messageId: string
  partId: string
  partKind: "text" | "reasoning" | "tool-input" | "compaction"
}
export type ScopeRef = { collection: string; scopeKey: string }
export type Change = {
  seq: number
  collection: string
  scopeKey: string
  rowKey: string | readonly string[]
  op: "insert" | "update" | "delete" | "reset"
  row: Row | null
  rowRevision?: string
  txid?: string
}

type StoreOptions = {
  onTxidTimeout?: (scopes: readonly ScopeRef[] | undefined) => void
  scheduleFrame?: (callback: () => void) => void
}

export function createConnectionStore(options: StoreOptions = {}) {
  const scopes = new Map<string, ReturnType<typeof createScope>>()
  const listeners = new Set<() => void>()
  const waiters = new Map<string, Set<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }>>()
  const recentTxids = new Set<string>()
  const deltas = new Map<string, { text: string; bytes: number; incomplete: boolean; snapshot: { text: string; incomplete: boolean } }>()
  const deltaListeners = new Map<string, Set<() => void>>()
  const deltaIdentityListeners = new Map<string, Set<() => void>>()
  const deltaIdentityRevisions = new Map<string, number>()
  const pendingDeltaNotifications = new Set<string>()
  let deltaFrameScheduled = false

  const getScope = (collection: string, scopeKey: string) => {
    const key = scopeIdentity(collection, scopeKey)
    const existing = scopes.get(key)
    if (existing) return existing
    const created = createScope(key)
    scopes.set(key, created)
    return created
  }
  const notify = () => listeners.forEach((listener) => listener())
  const notifyDelta = (key: string) => {
    pendingDeltaNotifications.add(key)
    if (deltaFrameScheduled) return
    deltaFrameScheduled = true
    ;(options.scheduleFrame ?? scheduleAnimationFrame)(() => {
      deltaFrameScheduled = false
      const pending = Array.from(pendingDeltaNotifications)
      pendingDeltaNotifications.clear()
      pending.forEach((item) => deltaListeners.get(item)?.forEach((listener) => listener()))
    })
  }
  const notifyDeltaIdentities = (sessionId: string) => {
    deltaIdentityRevisions.set(sessionId, (deltaIdentityRevisions.get(sessionId) ?? 0) + 1)
    deltaIdentityListeners.get(sessionId)?.forEach((listener) => listener())
  }
  const clearDelta = (key: string) => {
    if (!deltas.delete(key)) return
    notifyDeltaIdentities(identityFromDeltaKey(key).sessionId)
    notifyDelta(key)
  }
  const clearMessageDeltas = (sessionId: string, messageId: string) => {
    const prefix = `${sessionId}\u0000${messageId}\u0000`
    Array.from(deltas.keys()).forEach((key) => {
      if (key.startsWith(prefix)) clearDelta(key)
    })
  }
  const clearDeltasForSession = (sessionId: string) => {
    const prefix = `${sessionId}\u0000`
    Array.from(deltas.keys()).forEach((key) => {
      if (key.startsWith(prefix)) clearDelta(key)
    })
  }
  const clearPartDeltas = (sessionId: string, retained = new Set<string>()) => {
    const prefix = `${sessionId}\u0000`
    Array.from(deltas.keys()).forEach((key) => {
      if (!key.startsWith(prefix) || identityFromDeltaKey(key).partKind === "compaction" || retained.has(key)) return
      clearDelta(key)
    })
  }
  const finalize = (collection: string, scopeKey: string, rowKey: string | readonly string[], row: Row | null) => {
    if (collection === "parts" && Array.isArray(rowKey) && rowKey.length === 3) {
      const partKind = rowKey[1] === "tool" ? "tool-input" : rowKey[1]
      if (partKind === "text") {
        const key = partDeltaKey(scopeKey, rowKey)!
        const current = deltas.get(key)
        const text = typeof row?.text === "string" ? row.text : ""
        if (!row || current?.incomplete || (current && (current.text === text || !current.text.startsWith(text)))) clearDelta(key)
        return
      }
      if (partKind === "reasoning" && row && typeof (row.time as Row | undefined)?.completed !== "number") return
      if (partKind === "tool-input" && row && (row.state as Row | undefined)?.status === "pending") return
      if (["text", "reasoning", "tool-input"].includes(partKind))
        clearDelta(deltaKey({ sessionId: scopeKey, messageId: rowKey[0], partKind: partKind as DeltaIdentity["partKind"], partId: rowKey[2] }))
      return
    }
    if (collection !== "messages") return
    const messageId = typeof row?.id === "string" ? row.id : typeof rowKey === "string" ? rowKey : rowKey[0]
    if (!row) {
      clearMessageDeltas(scopeKey, messageId)
      return
    }
    if (row.type === "assistant" && typeof (row.time as Row | undefined)?.completed === "number") {
      clearMessageDeltas(scopeKey, messageId)
      return
    }
    if (row.type !== "compaction") return
    const prefix = `${scopeKey}\u0000${messageId}\u0000compaction\u0000`
    const keys = Array.from(deltas.keys()).filter((key) => key.startsWith(prefix))
    keys.forEach(clearDelta)
  }

  return {
    collection: (collection: string, scopeKey = "") => getScope(collection, scopeKey).collection,
    rows(collection: string, scopeKey = "") {
      return getScope(collection, scopeKey).collection.toArray.map((item) => item.row)
    },
    authoritativeRows(collection: string, scopeKey = "") {
      return Array.from(getScope(collection, scopeKey).authoritative.values(), (item) => item.row)
    },
    isAuthoritative: (collection: string, scopeKey: string, key: string | readonly string[]) =>
      getScope(collection, scopeKey).authoritative.has(wireKey(key)),
    cursor: (collection: string, scopeKey = "") => scopes.get(scopeIdentity(collection, scopeKey))?.cursor ?? 0,
    isReady: (collection: string, scopeKey = "") => scopes.get(scopeIdentity(collection, scopeKey))?.ready ?? false,
    scopeRefs: () => Array.from(scopes.values(), (scope) => scope.ref),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    applySnapshot(collection: string, scopeKey: string, rows: ReadonlyArray<{ key: string | readonly string[]; row: Row; revision?: string }>, throughSeq: number, replace = true) {
      const scope = getScope(collection, scopeKey)
      scope.control.begin()
      if (replace) {
        scope.authoritative.clear()
        for (const key of Array.from(scope.collection.keys())) scope.control.write({ type: "delete", key })
      }
      rows.forEach((item) => {
        finalize(collection, scopeKey, item.key, item.row)
        const key = wireKey(item.key)
        const value = stored(item.key, item.row, item.revision)
        scope.authoritative.set(key, value)
        scope.control.write(scope.collection.has(key) && !replace
          ? { type: "update", key, value }
          : { type: "insert", value })
      })
      scope.control.commit()
      if (replace && collection === "messages") {
        const messageIds = new Set(rows.map((item) => typeof item.row.id === "string" ? item.row.id : typeof item.key === "string" ? item.key : item.key[0]))
        const prefix = `${scopeKey}\u0000`
        Array.from(deltas.keys()).forEach((key) => {
          if (key.startsWith(prefix) && !messageIds.has(identityFromDeltaKey(key).messageId)) clearDelta(key)
        })
      }
      if (replace && collection === "parts") {
        clearPartDeltas(scopeKey, new Set(rows.flatMap((item) => {
          const key = partDeltaKey(scopeKey, item.key)
          return key && deltas.has(key) ? [key] : []
        })))
      }
      scope.ready = true
      if (!scope.initialized) {
        scope.initialized = true
        scope.control.markReady()
      }
      scope.cursor = throughSeq
      notify()
    },
    applyRows(frame: { throughSeq: number; changes: readonly Change[] }) {
      const affected = new Map<string, ReturnType<typeof createScope>>()
      const resetScopes = new Set<string>()
      frame.changes.forEach((change) => {
        const scope = getScope(change.collection, change.scopeKey)
        if (change.seq <= scope.cursor) return
        affected.set(scopeIdentity(change.collection, change.scopeKey), scope)
        if (!scope.open) {
          scope.control.begin()
          scope.open = true
        }
        if (change.op === "reset") {
          scope.authoritative.clear()
          scope.ready = false
          for (const key of Array.from(scope.collection.keys())) scope.control.write({ type: "delete", key })
          if (change.collection === "messages") clearDeltasForSession(change.scopeKey)
          if (change.collection === "parts") clearPartDeltas(change.scopeKey)
          resetScopes.add(scopeIdentity(change.collection, change.scopeKey))
          return
        }
        const key = wireKey(change.rowKey)
        finalize(change.collection, change.scopeKey, change.rowKey, change.row)
        if (change.op === "delete") {
          scope.authoritative.delete(key)
          scope.control.write({ type: "delete", key })
          return
        }
        const value = stored(key, change.row ?? {}, change.rowRevision)
        scope.authoritative.set(key, value)
        scope.control.write({
          type: scope.collection.has(key) ? "update" : "insert",
          key,
          value,
        })
      })
      affected.forEach((scope, key) => {
        scope.control.commit()
        scope.open = false
        scope.cursor = resetScopes.has(key) ? 0 : Math.max(scope.cursor, frame.throughSeq)
      })
      if (affected.size > 0) notify()
      const txids = frame.changes.flatMap((change) => change.txid ? [change.txid] : [])
      txids.forEach((txid) => {
        recentTxids.add(txid)
        waiters.get(txid)?.forEach((waiter) => {
          clearTimeout(waiter.timer)
          waiter.resolve()
        })
        waiters.delete(txid)
      })
      while (recentTxids.size > 256) recentTxids.delete(recentTxids.values().next().value!)
    },
    awaitTxid(txid: string, timeoutMs = 10_000, affectedScopes?: readonly ScopeRef[]) {
      if (recentTxids.has(txid)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const waiter = {
          resolve,
          timer: setTimeout(() => {
            const pending = waiters.get(txid)
            pending?.delete(waiter)
            if (pending?.size === 0) waiters.delete(txid)
            options.onTxidTimeout?.(affectedScopes)
            resolve()
          }, timeoutMs),
        }
        const pending = waiters.get(txid) ?? new Set()
        pending.add(waiter)
        waiters.set(txid, pending)
      })
    },
    awaitAuthoritativeState(input: {
      collection: string
      scopeKey: string
      timeoutMs: number
      predicate: (rows: Row[]) => boolean
    }) {
      const rows = () => Array.from(getScope(input.collection, input.scopeKey).authoritative.values(), (item) => item.row)
      if (input.predicate(rows())) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          unsubscribe()
          reject(new Error("Authoritative state did not update before the deadline"))
        }, input.timeoutMs)
        const unsubscribe = this.subscribe(() => {
          if (!input.predicate(rows())) return
          clearTimeout(timer)
          unsubscribe()
          resolve()
        })
      })
    },
    applyDelta(input: DeltaIdentity & { offset: number; text: string }) {
      const key = deltaKey(input)
      const previous = deltas.get(key)
      const current = previous ?? { text: "", bytes: 0, incomplete: false, snapshot: { text: "", incomplete: false } }
      const encoded = new TextEncoder().encode(input.text)
      if (input.offset + encoded.byteLength <= current.bytes) return
      if (input.offset > current.bytes) {
        const next = { ...current, incomplete: true, snapshot: { text: current.text, incomplete: true } }
        deltas.set(key, next)
        if (!previous) notifyDeltaIdentities(input.sessionId)
        notifyDelta(key)
        return
      }
      const suffix = input.offset < current.bytes
        ? new TextDecoder().decode(encoded.subarray(current.bytes - input.offset))
        : input.text
      const text = new TextEncoder().encode(current.text).byteLength < current.bytes
        ? current.text
        : deltaPreview(current.text + suffix)
      const bytes = Math.max(current.bytes, input.offset + encoded.byteLength)
      deltas.set(key, { text, bytes, incomplete: current.incomplete, snapshot: { text, incomplete: current.incomplete } })
      if (!previous) notifyDeltaIdentities(input.sessionId)
      notifyDelta(key)
    },
    delta(identity: DeltaIdentity) {
      return deltas.get(deltaKey(identity))?.snapshot
    },
    deltaIdentities(sessionId: string) {
      const prefix = `${sessionId}\u0000`
      return Array.from(deltas.keys())
        .flatMap((key) => key.startsWith(prefix) ? [identityFromDeltaKey(key)] : [])
    },
    deltaIdentityRevision(sessionId: string) {
      return deltaIdentityRevisions.get(sessionId) ?? 0
    },
    subscribeDeltaIdentities(sessionId: string, listener: () => void) {
      const scoped = deltaIdentityListeners.get(sessionId) ?? new Set()
      scoped.add(listener)
      deltaIdentityListeners.set(sessionId, scoped)
      return () => {
        scoped.delete(listener)
        if (scoped.size === 0) deltaIdentityListeners.delete(sessionId)
      }
    },
    subscribeDelta(identity: DeltaIdentity, listener: () => void) {
      const key = deltaKey(identity)
      const scoped = deltaListeners.get(key) ?? new Set()
      scoped.add(listener)
      deltaListeners.set(key, scoped)
      return () => {
        scoped.delete(listener)
        if (scoped.size === 0) deltaListeners.delete(key)
      }
    },
    clearSessionDeltas(sessionId: string) {
      clearDeltasForSession(sessionId)
    },
    dropCursors(targets?: readonly ScopeRef[]) {
      const identities = targets && new Set(targets.map((scope) => scopeIdentity(scope.collection, scope.scopeKey)))
      scopes.forEach((scope, key) => {
        if (!identities || identities.has(key)) scope.cursor = 0
      })
    },
    dropScope(collection: string, scopeKey: string) {
      const key = scopeIdentity(collection, scopeKey)
      const scope = scopes.get(key)
      if (!scope) return
      scopes.delete(key)
      void scope.collection.cleanup()
      notify()
    },
    dropSession(sessionId: string) {
      ;["messages", "parts", "sessionInputs", "todos"].forEach((collection) => {
        const key = scopeIdentity(collection, sessionId)
        const scope = scopes.get(key)
        if (!scope) return
        scopes.delete(key)
        void scope.collection.cleanup()
      })
      this.clearSessionDeltas(sessionId)
      notify()
    },
    clear() {
      scopes.forEach((scope) => void scope.collection.cleanup())
      scopes.clear()
      Array.from(deltas.keys()).forEach(clearDelta)
      notify()
    },
    dispose() {
      waiters.forEach((pending) => pending.forEach((waiter) => {
        clearTimeout(waiter.timer)
        waiter.resolve()
      }))
      waiters.clear()
      this.clear()
      listeners.clear()
      deltaListeners.clear()
      deltaIdentityListeners.clear()
    },
  }
}

function createScope(id: string) {
  let control: ScopeControl | undefined
  const collection = createCollection<StoredRow, string>({
    id: `hena:${id}`,
    getKey: (item) => item.__key,
    sync: {
      sync: (input) => {
        control = input
      },
      rowUpdateMode: "full",
    },
  })
  void collection.preload()
  if (!control) throw new Error(`Collection sync did not start for ${id}`)
  const separator = id.indexOf("\u0000")
  return {
    collection,
    control,
    cursor: 0,
    open: false,
    ready: false,
    initialized: false,
    authoritative: new Map<string, StoredRow>(),
    ref: { collection: id.slice(0, separator), scopeKey: id.slice(separator + 1) },
  }
}

function stored(key: string | readonly string[], row: Row, revision?: string): StoredRow {
  return { __key: wireKey(key), __revision: revision, row }
}

function wireKey(key: string | readonly string[]) {
  return typeof key === "string" ? key : JSON.stringify(key)
}

function scopeIdentity(collection: string, scopeKey: string) {
  return `${collection}\u0000${scopeKey}`
}

function deltaKey(identity: DeltaIdentity) {
  return `${identity.sessionId}\u0000${identity.messageId}\u0000${identity.partKind}\u0000${identity.partId}`
}

function partDeltaKey(sessionId: string, rowKey: string | readonly string[]) {
  if (!Array.isArray(rowKey) || rowKey.length !== 3) return
  const partKind = rowKey[1] === "tool" ? "tool-input" : rowKey[1]
  if (partKind !== "text" && partKind !== "reasoning" && partKind !== "tool-input") return
  return deltaKey({ sessionId, messageId: rowKey[0]!, partKind, partId: rowKey[2]! })
}

function identityFromDeltaKey(key: string): DeltaIdentity {
  const [sessionId, messageId, partKind, partId] = key.split("\u0000")
  return { sessionId: sessionId!, messageId: messageId!, partKind: partKind as DeltaIdentity["partKind"], partId: partId! }
}

function deltaPreview(input: string) {
  const bytes = new TextEncoder().encode(input.split("\n", 501).slice(0, 500).join("\n"))
  const target = Math.min(bytes.length, 32 * 1024)
  if (target === bytes.length || bytes[target]! >> 6 !== 2) return new TextDecoder().decode(bytes.subarray(0, target))
  if (bytes[target - 1]! >> 6 !== 2) return new TextDecoder().decode(bytes.subarray(0, target - 1))
  if (bytes[target - 2]! >> 6 !== 2) return new TextDecoder().decode(bytes.subarray(0, target - 2))
  return new TextDecoder().decode(bytes.subarray(0, target - 3))
}

function scheduleAnimationFrame(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback)
    return
  }
  setTimeout(callback, 0)
}
