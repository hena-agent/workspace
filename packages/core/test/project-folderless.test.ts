import { afterAll, describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import { Effect, Exit, Schema } from "effect"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { Global } from "@hena/core/global"
import { Project } from "@hena/core/project"
import { ProjectDirectoryTable, ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { testEffect } from "./lib/effect"

const data = await fs.mkdtemp(path.join(os.tmpdir(), "hena-folderless-project-"))
afterAll(() => fs.rm(data, { recursive: true, force: true }))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, EventV2.node]), [
    [Global.node, Global.layerWith({ data })],
  ]),
)

describe("folderless projects", () => {
  it.live("creates, lists, resolves, and identifies a folderless project", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const projects = yield* Project.Service
      const created = yield* projects.create(Schema.decodeUnknownSync(Project.CreateInput)({ name: "  Research  " }))
      const child = AbsolutePath.make(path.join(created.directory, "notes"))
      yield* Effect.promise(() => fs.mkdir(child))
      yield* db
        .insert(ProjectDirectoryTable)
        .values({
          project_id: created.id,
          directory: AbsolutePath.make(path.join(created.directory, "secondary")),
          type: "root",
        })
        .run()

      expect(String(created.name)).toBe("Research")
      expect(String(created.directory)).toBe(
        yield* Effect.promise(() => fs.realpath(path.join(data, "projects", created.id))),
      )
      expect((yield* projects.list()).filter((project) => project.id === created.id)).toEqual([created])
      expect(yield* projects.isFolderless(created.id)).toBe(true)
      expect(yield* projects.isFolderless(Project.ID.global)).toBe(false)
      expect(yield* projects.resolve(child)).toEqual({ id: created.id, directory: created.directory, vcs: undefined })
      expect(
        yield* db
          .select({ worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(eq(ProjectTable.id, created.id))
          .get(),
      ).toEqual({ worktree: null })
      expect(
        yield* db
          .select({ directory: ProjectDirectoryTable.directory })
          .from(ProjectDirectoryTable)
          .where(eq(ProjectDirectoryTable.project_id, created.id))
          .get(),
      ).toEqual({ directory: created.directory })
      if (process.platform !== "win32") {
        expect((yield* Effect.promise(() => fs.stat(created.directory))).mode & 0o777).toBe(0o700)
      }
    }),
  )

  it.live("removes its managed directory when persistence fails", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const projects = yield* Project.Service
      yield* Effect.promise(() => fs.mkdir(path.join(data, "projects"), { recursive: true }))
      const before = yield* Effect.promise(() => fs.readdir(path.join(data, "projects")))
      yield* db.run(
        sql`CREATE TRIGGER reject_folderless_insert BEFORE INSERT ON project BEGIN SELECT RAISE(ABORT, 'reject'); END;`,
      )

      expect(
        Exit.isFailure(
          yield* projects.create(Schema.decodeUnknownSync(Project.CreateInput)({ name: "Failure" })).pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(yield* Effect.promise(() => fs.readdir(path.join(data, "projects")))).toEqual(before)
    }),
  )

  it.live("keeps committed state when an event listener fails", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const projects = yield* Project.Service
      const observed = new Array<string>()
      yield* events.listen(() => Effect.die("listener failed"))
      yield* events.listen((event) => Effect.sync(() => observed.push(event.type)))

      const created = yield* projects.create(Schema.decodeUnknownSync(Project.CreateInput)({ name: "Listener" }))

      expect(yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, created.id)).get()).toBeDefined()
      expect(yield* Effect.promise(() => fs.stat(created.directory))).toBeDefined()
      expect(observed).toEqual([Project.Event.ChatCreated.type])
    }),
  )
})
