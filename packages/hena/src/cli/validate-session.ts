import { createHenaClient } from "@hena/sdk/v2"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"

const decodeSessionID = Schema.decodeUnknownSync(SessionID)

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (!input.sessionID) return

  const sessionID = (() => {
    try {
      return decodeSessionID(input.sessionID)
    } catch (error) {
      throw new Error(`Invalid session ID: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error })
    }
  })()

  await createHenaClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
    headers: input.headers,
  }).session.get({ sessionID }, { throwOnError: true })
}
