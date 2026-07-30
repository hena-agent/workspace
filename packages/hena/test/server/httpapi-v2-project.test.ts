import { afterEach, describe, expect, test } from "bun:test"
import { Context, Schema } from "effect"
import fs from "fs/promises"
import path from "path"
import { Project } from "@hena/schema/project"
import { Session } from "@hena/schema/session"
import { Global } from "@hena/core/global"
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
  test("creates with one selected folder", async () => {
    await using folder = await tmpdir()
    const createdResponse = await request("/api/project", {
      method: "POST",
      body: JSON.stringify({ folder: folder.path }),
    })
    expect(createdResponse.status).toBe(200)
    const created = Schema.decodeUnknownSync(Project.ManagedInfo)(await createdResponse.json())

    try {
      expect(created.name).toBe(Project.Name.make(path.basename(folder.path)))
      expect(String(created.folder)).toBe(folder.path)
      expect(String(created.worktree)).not.toBe(folder.path)

      const duplicate = await request("/api/project", {
        method: "POST",
        body: JSON.stringify({ name: "Duplicate folder", folder: folder.path }),
      })
      expect(duplicate.status).toBe(409)
    } finally {
      await fs.rm(path.join(Global.Path.data, "projects", created.id), { recursive: true, force: true })
    }
  })

  test("creates a named folderless project and permits one folder attachment", async () => {
    await using folder = await tmpdir()
    const createdResponse = await request("/api/project", {
      method: "POST",
      body: JSON.stringify({ name: "Research" }),
    })
    expect(createdResponse.status).toBe(200)
    const created = Schema.decodeUnknownSync(Project.ManagedInfo)(await createdResponse.json())

    try {
      expect(created.name).toBe(Project.Name.make("Research"))
      expect(created.folder).toBeUndefined()
      expect(path.isAbsolute(created.worktree)).toBe(true)

      const sessionResponse = await request("/api/session", {
        method: "POST",
        body: JSON.stringify({ location: { directory: created.worktree } }),
      })
      expect(sessionResponse.status).toBe(200)
      const session = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(await sessionResponse.json()).data
      expect(session.projectID).toBe(created.id)

      const attachedResponse = await request(`/api/project/${created.id}/folder`, {
        method: "PUT",
        body: JSON.stringify({ folder: folder.path }),
      })
      expect(attachedResponse.status).toBe(200)
      const attached = Schema.decodeUnknownSync(Project.ManagedInfo)(await attachedResponse.json())
      expect(attached.id).toBe(created.id)
      expect(attached.name).toBe(created.name)
      expect(attached.worktree).toBe(created.worktree)
      expect(String(attached.folder)).toBe(folder.path)
      const movedResponse = await request(`/api/session/${session.id}`)
      const moved = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(await movedResponse.json()).data
      expect(moved.projectID).toBe(created.id)
      expect(String(moved.location.directory)).toBe(folder.path)

      const conflict = await request(`/api/project/${created.id}/folder`, {
        method: "PUT",
        body: JSON.stringify({ folder: folder.path }),
      })
      expect(conflict.status).toBe(409)
    } finally {
      await fs.rm(created.worktree, { recursive: true, force: true })
    }
  })

  test("requires a non-empty project name", async () => {
    const response = await request("/api/project", { method: "POST", body: JSON.stringify({ name: "   " }) })
    expect(response.status).toBe(400)
  })

})
