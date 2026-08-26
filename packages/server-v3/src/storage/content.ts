import type { Database } from "bun:sqlite"

type ContentRow = { content: Uint8Array; total_bytes: number }

export class InvalidContentOffset extends Error {}

export function createContentStore(database: Database) {
  const insert = database.query(`
    INSERT OR REPLACE INTO full_content (id, session_id, revision, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const get = database.query<ContentRow, [number, number, string, string, string]>(`
    SELECT substr(CAST(content AS BLOB), ?, ?) AS content,
      length(CAST(content AS BLOB)) AS total_bytes
    FROM full_content WHERE id = ? AND session_id = ? AND revision = ?
  `)
  const compact = database.query(`
    DELETE FROM full_content WHERE rowid IN (
      SELECT full_content.rowid FROM full_content
      WHERE NOT EXISTS (
        SELECT 1 FROM full_content_reference
        WHERE full_content_reference.id = full_content.id
          AND full_content_reference.session_id = full_content.session_id
          AND full_content_reference.revision = full_content.revision
      )
      ORDER BY full_content.created_at, full_content.rowid
      LIMIT ?
    )
  `)

  return {
    put(input: { id: string; sessionID: string; revision: string; text: string }) {
      insert.run(input.id, input.sessionID, input.revision, new TextEncoder().encode(input.text), Date.now())
    },
    page(input: { id: string; sessionID: string; revision: string; offset: number; limit: number }) {
      const row = get.get(input.offset + 1, input.limit + 4, input.id, input.sessionID, input.revision)
      if (!row) return undefined
      if (input.offset > row.total_bytes || !isCodePointBoundary(row.content, 0)) throw new InvalidContentOffset()
      const boundary = endingBoundary(row.content, Math.min(row.content.length, input.limit))
      const end = boundary === 0 && input.offset < row.total_bytes ? followingBoundary(row.content, 0) : boundary
      return {
        text: new TextDecoder().decode(row.content.subarray(0, end)),
        offset: input.offset,
        nextOffset: input.offset + end,
        totalBytes: row.total_bytes,
        revision: input.revision,
      }
    },
    compact(maxRows = 1_000) {
      compact.run(maxRows)
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
