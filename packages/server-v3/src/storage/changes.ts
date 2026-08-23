import type { Database } from "bun:sqlite"

export type ChangeOperation = "insert" | "update" | "delete" | "reset"

export type ChangeInput = {
  collection: string
  scopeKey: string
  rowKey: string
  op: ChangeOperation
  row: unknown | null
  rowRevision?: string
  txid?: string
}

export type Change = ChangeInput & {
  seq: number
  runtimeId: string
  createdAt: number
}

type ChangeRow = {
  seq: number
  collection: string
  scope_key: string
  row_key: string
  op: ChangeOperation
  row: string | null
  row_revision: string | null
  txid: string | null
  runtime_id: string
  created_at: number
}

export function createChangeStore(database: Database, feed: { get(): { runtimeId: string } }) {
  const listeners = new Map<string, Set<(change: Change) => void>>()
  const select = database.query<ChangeRow, [string, string, number]>(`
    SELECT seq, collection, scope_key, row_key, op, row, row_revision, txid, runtime_id, created_at
    FROM collection_change
    WHERE collection = ? AND scope_key = ? AND seq > ?
    ORDER BY seq
  `)
  const current = database.query<{ seq: number }, []>("SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change")
  const persisted = database.query<ChangeRow, [number]>(`
    SELECT seq, collection, scope_key, row_key, op, row, row_revision, txid, runtime_id, created_at
    FROM collection_change
    WHERE seq > ?
    ORDER BY seq
  `)
  const latest = database.query<{ seq: number; txid: string | null }, [string, string]>(`
    SELECT seq, txid FROM collection_change
    WHERE collection = ? AND scope_key = ?
    ORDER BY seq DESC LIMIT 1
  `)
  const latestRow = database.query<{ seq: number; txid: string | null }, [string, string, string]>(`
    SELECT seq, txid FROM collection_change
    WHERE collection = ? AND scope_key = ? AND row_key = ?
    ORDER BY seq DESC LIMIT 1
  `)

  let publishedSeq = current.get()!.seq
  const publish = (change: Change) => {
    publishedSeq = Math.max(publishedSeq, change.seq)
    listeners.get(scopeKey(change.collection, change.scopeKey))?.forEach((listener) => listener(change))
  }
  const publishPersisted = () => persisted.all(publishedSeq).map(fromRow).forEach(publish)

  const store = {
    append(input: Omit<ChangeInput, "row"> & { row?: unknown | null }): Change {
      if (input.op === "reset" && (input.rowKey !== "" || input.row != null))
        throw new Error("reset must have an empty row key and null row")
      if (input.op !== "reset" && input.rowKey === "") throw new Error("only reset may have an empty row key")
      const createdAt = Date.now()
      const runtimeId = feed.get().runtimeId
      const result = database
        .query(
          `
        INSERT INTO collection_change (collection, scope_key, row_key, op, row, row_revision, txid, runtime_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          input.collection,
          input.scopeKey,
          input.rowKey,
          input.op,
          input.row == null ? null : JSON.stringify(input.row),
          input.rowRevision ?? null,
          input.txid ?? null,
          runtimeId,
          createdAt,
        )
      const change = { ...input, row: input.row ?? null, seq: Number(result.lastInsertRowid), runtimeId, createdAt }
      publish(change)
      return change
    },
    after(collection: string, scopeKey: string, seq: number) {
      return select.all(collection, scopeKey, seq).map(fromRow)
    },
    current() {
      return current.get()!.seq
    },
    latest(scopes: ReadonlyArray<{ collection: string; scopeKey: string; rowKey?: string }>) {
      return scopes
        .map((scope) =>
          scope.rowKey
            ? latestRow.get(scope.collection, scope.scopeKey, scope.rowKey)
            : latest.get(scope.collection, scope.scopeKey),
        )
        .filter((change): change is { seq: number; txid: string | null } => change !== null)
        .sort((left, right) => right.seq - left.seq)[0]
    },
    reset(collection: string, scopeKey: string) {
      return store.append({ collection, scopeKey, rowKey: "", op: "reset", row: null })
    },
    subscribe(collection: string, scope: string, listener: (change: Change) => void) {
      const key = scopeKey(collection, scope)
      const scoped = listeners.get(key) ?? new Set()
      scoped.add(listener)
      listeners.set(key, scoped)
      return () => {
        scoped.delete(listener)
        if (scoped.size === 0) listeners.delete(key)
      }
    },
    publishPersisted,
    compact(input: { now: number; maxAgeMs: number; maxRows: number }) {
      const age = database
        .query<
          { seq: number },
          [number]
        >("SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change WHERE created_at < ?")
        .get(input.now - input.maxAgeMs)!.seq
      const size = database
        .query<{ seq: number }, [number]>(
          `
        SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change
        WHERE seq NOT IN (SELECT seq FROM collection_change ORDER BY seq DESC LIMIT ?)
      `,
        )
        .get(input.maxRows)!.seq
      const retainedFloor = Math.max(age, size)
      if (retainedFloor > 0) database.query("DELETE FROM collection_change WHERE seq <= ?").run(retainedFloor)
      return retainedFloor
    },
    close() {
      listeners.clear()
    },
  }

  return store
}

function scopeKey(collection: string, scope: string) {
  return `${collection}\u0000${scope}`
}

function fromRow(row: ChangeRow): Change {
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
