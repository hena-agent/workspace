const MaxItems = 500
const MaxPayloadBytes = 1024 * 1024 - 16 * 1024

export function pages<Item>(items: readonly Item[], envelope: (items: readonly Item[]) => unknown = identity) {
  return items.reduce<Item[][]>((output, item) => {
    const current = output.at(-1)
    if (!current || current.length >= MaxItems || bytes(envelope([...current, item])) > MaxPayloadBytes) {
      if (bytes(envelope([item])) > MaxPayloadBytes) throw new Error("Stream item exceeds frame limit")
      output.push([item])
      return output
    }
    current.push(item)
    return output
  }, [])
}

export function fitsPage<Item>(items: readonly Item[], envelope: (items: readonly Item[]) => unknown = identity) {
  return items.length <= MaxItems && bytes(envelope(items)) <= MaxPayloadBytes
}

export function fitsCollectionRow(
  collection: string,
  scopeKey: string,
  row: { readonly key: string; readonly row: unknown; readonly revision: string },
) {
  return fitsPage(
    [{
      seq: Number.MAX_SAFE_INTEGER,
      collection,
      scopeKey,
      rowKey: row.key,
      op: "insert",
      row: row.row,
      rowRevision: row.revision,
      txid: "x".repeat(64),
      runtimeId: "x".repeat(64),
      createdAt: Number.MAX_SAFE_INTEGER,
    }],
    (changes) => ({
      type: "rows",
      affectedScopes: [{ collection, scopeKey }],
      fromSeq: Number.MAX_SAFE_INTEGER,
      throughSeq: Number.MAX_SAFE_INTEGER,
      changes,
    }),
  )
}

function identity<Item>(items: readonly Item[]) {
  return items
}

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
