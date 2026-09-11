import { sql } from "drizzle-orm"
import { SessionInputTable, SessionMessageTable } from "@hena/core/session/sql"

// Transcript and inbox ownership outrank user-editable metadata, including admit-only sessions.
// Keep the outer ID qualified: Drizzle unqualifies interpolated columns in single-table selections.
export const runtime = sql<"legacy" | "canonical">`case when
  exists (select 1 from ${SessionMessageTable} where ${SessionMessageTable.session_id} = "session"."id")
  or exists (select 1 from ${SessionInputTable} where ${SessionInputTable.session_id} = "session"."id")
  then 'canonical' else 'legacy' end`

export function runtimeMetadata(runtime: "legacy" | "canonical", metadata?: Record<string, unknown> | null) {
  // Preserve the existing workspace metadata contract when no runtime hint is needed.
  if (runtime === "legacy" && metadata?.appRuntime === undefined) return metadata ?? undefined
  return { ...metadata, appRuntime: runtime }
}
