import type { Database } from "bun:sqlite"

type ContentRow = { content: string }

export class InvalidContentOffset extends Error {}

export function createContentStore(database: Database) {
  const insert = database.query(`
    INSERT OR REPLACE INTO full_content (id, session_id, revision, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const get = database.query<ContentRow, [string, string, string]>(`
    SELECT content FROM full_content WHERE id = ? AND session_id = ? AND revision = ?
  `)
  const compact = database.query(`
    WITH referenced AS (
      SELECT collection_row.scope_key AS session_id,
        json_extract(content.value, '$.id') AS id,
        json_extract(content.value, '$.revision') AS revision
      FROM collection_row, json_tree(collection_row.row) AS content
      WHERE collection_row.collection IN ('messages', 'parts', 'sessionInputs')
        AND content.key = 'content' AND content.type = 'object'
      UNION
      SELECT collection_change.scope_key AS session_id,
        json_extract(content.value, '$.id') AS id,
        json_extract(content.value, '$.revision') AS revision
      FROM collection_change, json_tree(collection_change.row) AS content
      WHERE collection_change.collection IN ('messages', 'parts', 'sessionInputs')
        AND content.key = 'content' AND content.type = 'object'
    )
    DELETE FROM full_content
    WHERE NOT EXISTS (
      SELECT 1 FROM referenced
      WHERE referenced.id = full_content.id
        AND referenced.session_id = full_content.session_id
        AND referenced.revision = full_content.revision
    )
  `)

  return {
    put(input: { id: string; sessionID: string; revision: string; text: string }) {
      insert.run(input.id, input.sessionID, input.revision, input.text, Date.now())
    },
    page(input: { id: string; sessionID: string; revision: string; offset: number; limit: number }) {
      const row = get.get(input.id, input.sessionID, input.revision)
      if (!row) return undefined
      const bytes = new TextEncoder().encode(row.content)
      if (input.offset > bytes.length || !isCodePointBoundary(bytes, input.offset)) throw new InvalidContentOffset()
      const boundary = endingBoundary(bytes, Math.min(bytes.length, input.offset + input.limit))
      const end =
        boundary === input.offset && input.offset < bytes.length ? followingBoundary(bytes, input.offset) : boundary
      return {
        text: new TextDecoder().decode(bytes.subarray(input.offset, end)),
        offset: input.offset,
        nextOffset: end,
        totalBytes: bytes.length,
        revision: input.revision,
      }
    },
    compact() {
      compact.run()
    },
  }
}

export function preview(input: string, maxBytes = 32 * 1024, maxLines = 500) {
  const lines = input.split("\n")
  const limited = lines.slice(0, maxLines).join("\n")
  const bytes = new TextEncoder().encode(limited)
  const totalBytes = new TextEncoder().encode(input).byteLength
  return {
    text: new TextDecoder().decode(bytes.subarray(0, endingBoundary(bytes, Math.min(bytes.length, maxBytes)))),
    truncated: lines.length > maxLines || totalBytes > maxBytes,
    totalBytes,
    totalLines: lines.length,
  }
}

function endingBoundary(bytes: Uint8Array, target: number) {
  if (target === bytes.length) return target
  const first = bytes[target]
  if (first === undefined || first >> 6 !== 2) return target
  const second = bytes[target - 1]
  if (second === undefined) return target
  if (second >> 6 !== 2) return target - 1
  const third = bytes[target - 2]
  if (third === undefined || third >> 6 !== 2) return target - 2
  return target - 3
}

function isCodePointBoundary(bytes: Uint8Array, offset: number) {
  return offset === bytes.length || bytes[offset] === undefined || bytes[offset]! >> 6 !== 2
}

function followingBoundary(bytes: Uint8Array, offset: number) {
  return (
    [offset + 1, offset + 2, offset + 3, offset + 4].find(
      (candidate) => candidate <= bytes.length && isCodePointBoundary(bytes, candidate),
    ) ?? bytes.length
  )
}
