import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createHenaClient } from "@hena/sdk/v2/client"
import { createDirSyncContext } from "./directory-sync"
import { createServerSession } from "./server-session"

test("directory execution errors read and write the shared Session store", () => {
  createRoot((dispose) => {
    const client = createHenaClient({
      baseUrl: "http://server",
      fetch: Object.assign(async () => Response.json({}), { preconnect() {} }),
    })
    const session = createServerSession(client)
    const sync = createDirSyncContext(
      "/repo",
      {
        session,
        child: () => [{ session: [], execution_error: {}, path: { directory: "/repo" } }, () => {}],
      } as unknown as Parameters<typeof createDirSyncContext>[1],
      {
        createClient: () => client,
      } as unknown as Parameters<typeof createDirSyncContext>[2],
    )
    session.apply({
      type: "session.next.execution.status",
      data: {
        sessionID: "ses_directory",
        status: { type: "failed", error: { message: "execution failed" } },
      },
    })
    expect(sync.data.execution_error).toBe(session.data.execution_error)
    expect(sync.data.execution_error.ses_directory).toBe("execution failed")
    sync.set("execution_error", "ses_directory", "updated")
    expect(session.data.execution_error.ses_directory).toBe("updated")
    session.apply({
      type: "session.next.execution.status",
      data: {
        sessionID: "ses_directory",
        status: { type: "running" },
      },
    })
    expect(sync.data.execution_error.ses_directory).toBeUndefined()
    dispose()
  })
})
