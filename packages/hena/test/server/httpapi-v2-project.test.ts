import { afterEach, describe, expect, test } from "bun:test"
import { Context, Schema } from "effect"
import fs from "fs/promises"
import { Project } from "@hena/schema/project"
import { Session } from "@hena/schema/session"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, init: RequestInit = {}) {
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("v2 project HttpApi", () => {
  test("creates and lists a named folderless chat project", async () => {
    const response = await request("/api/project", {
      method: "POST",
      body: JSON.stringify({ name: "Research" }),
    })
    expect(response.status).toBe(200)
    const created = Schema.decodeUnknownSync(Project.Chat)(await response.json())

    try {
      expect(created.name).toBe(Project.Name.make("Research"))
      const listed = Schema.decodeUnknownSync(Schema.Array(Project.Chat))(await (await request("/api/project")).json())
      expect(listed).toContainEqual(created)

      const sessionResponse = await request("/api/session", {
        method: "POST",
        body: JSON.stringify({ location: { directory: created.directory } }),
      })
      const session = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(await sessionResponse.json()).data
      expect(session.projectID).toBe(created.id)
    } finally {
      await fs.rm(created.directory, { recursive: true, force: true })
    }
  })

  test("attaches once and returns affected sessions", async () => {
    await using folder = await tmpdir()
    const created = Schema.decodeUnknownSync(Project.Chat)(
      await (
        await request("/api/project", { method: "POST", body: JSON.stringify({ name: "Research" }) })
      ).json(),
    )

    try {
      const session = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
        await (
          await request("/api/session", {
            method: "POST",
            body: JSON.stringify({ location: { directory: created.directory } }),
          })
        ).json(),
      ).data
      const response = await request(`/api/project/${created.id}/folder`, {
        method: "PUT",
        body: JSON.stringify({ folder: folder.path }),
      })
      expect(response.status).toBe(200)
      const attached = Schema.decodeUnknownSync(Project.Attachment)(await response.json())
      expect(String(attached.project.directory)).toBe(folder.path)
      expect(attached.sessionIDs).toEqual([session.id])
      expect((await request(`/api/project/${created.id}`)).status).toBe(404)
    } finally {
      await fs.rm(created.directory, { recursive: true, force: true })
    }
  })
})
