import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { Database } from "@hena/core/database/database"
import { EventV2 } from "@hena/core/event"
import { EventTable } from "@hena/core/event/sql"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { Project } from "@hena/core/project"
import { ProjectDirectoryTable, ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { SessionEvent } from "@hena/core/session/event"
import { SessionContextEpochTable, SessionTable } from "@hena/core/session/sql"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, EventV2.node])))

describe("folderless projects", () => {
  it.live("creates and lists a chat project with a null worktree and private directory", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const projects = yield* Project.Service
      const created = yield* Effect.acquireRelease(projects.create({ name: "  Research  " }), (project) =>
        Effect.promise(() => fs.rm(project.directory, { recursive: true, force: true })),
      )

      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, created.id)).get().pipe(Effect.orDie)
      const directory = yield* db
        .select()
        .from(ProjectDirectoryTable)
        .where(eq(ProjectDirectoryTable.project_id, created.id))
        .get()
        .pipe(Effect.orDie)

      expect(row?.worktree).toBeNull()
      expect(row?.name).toBe("Research")
      expect(directory?.directory).toBe(created.directory)
      expect(path.isAbsolute(created.directory)).toBe(true)
      expect(yield* projects.list()).toContainEqual(created)
      expect(yield* projects.isFolderless(created.id)).toBe(true)
      expect((yield* projects.resolve(created.directory)).id).toBe(created.id)
    }),
  )

  it.live("attaches to an existing destination and moves only source sessions", () =>
    Effect.gen(function* () {
      const repo = yield* temporaryRepo
      const conflictingRepo = yield* temporaryRepo
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const projects = yield* Project.Service
      const source = yield* Effect.acquireRelease(projects.create({ name: "Chat" }), (project) =>
        Effect.promise(() => fs.rm(project.directory, { recursive: true, force: true })),
      )
      const destination = yield* projects.resolve(AbsolutePath.make(repo.path))
      yield* db
        .insert(ProjectTable)
        .values({ id: destination.id, worktree: destination.directory, vcs: destination.vcs?.type, sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      const sourceRoot = SessionV2.ID.create()
      const sourceChild = SessionV2.ID.create()
      const sourceDotChild = SessionV2.ID.create()
      const existing = SessionV2.ID.create()
      yield* db
        .insert(SessionTable)
        .values([
          session(sourceRoot, source.id, source.directory, ""),
          session(sourceChild, source.id, AbsolutePath.make(path.join(source.directory, "notes")), "notes"),
          session(sourceDotChild, source.id, AbsolutePath.make(path.join(source.directory, "..notes")), "..notes"),
          session(existing, destination.id, destination.directory, "keep"),
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionContextEpochTable)
        .values([
          epoch(sourceRoot),
          epoch(sourceChild),
          epoch(sourceDotChild),
          epoch(existing),
        ])
        .run()
        .pipe(Effect.orDie)

      const observed = new Array<SessionEvent.Moved>()
      const unsubscribe = yield* events.listen((event) =>
        event.type === SessionEvent.Moved.type
          ? Effect.sync(() => observed.push(event as SessionEvent.Moved))
          : Effect.void,
      )
      const result = yield* projects.attachFolder({ projectID: source.id, folder: repo.path })
      yield* unsubscribe
      expect(result.project).toMatchObject({ id: destination.id, directory: destination.directory, vcs: "git" })
      expect(new Set(result.sessionIDs)).toEqual(new Set([sourceRoot, sourceChild, sourceDotChild]))

      const rows = yield* db
        .select()
        .from(SessionTable)
        .where(inArray(SessionTable.id, [sourceRoot, sourceChild, sourceDotChild, existing]))
        .all()
        .pipe(Effect.orDie)
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: sourceRoot, project_id: destination.id, directory: destination.directory, path: null }),
          expect.objectContaining({
            id: sourceChild,
            project_id: destination.id,
            directory: path.join(destination.directory, "notes"),
            path: "notes",
          }),
          expect.objectContaining({
            id: sourceDotChild,
            project_id: destination.id,
            directory: path.join(destination.directory, "..notes"),
            path: "..notes",
          }),
          expect.objectContaining({ id: existing, project_id: destination.id, directory: destination.directory, path: "keep" }),
        ]),
      )
      expect(
        yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, source.id)).get().pipe(Effect.orDie),
      ).toBeUndefined()
      expect(
        yield* db
          .select()
          .from(ProjectDirectoryTable)
          .where(eq(ProjectDirectoryTable.project_id, source.id))
          .get()
          .pipe(Effect.orDie),
      ).toBeUndefined()
      expect(yield* Effect.promise(() => fs.stat(source.directory).then(() => true, () => false))).toBe(false)
      const epochs = yield* db.select().from(SessionContextEpochTable).all().pipe(Effect.orDie)
      expect(epochs.map((item) => item.session_id)).toEqual([existing])
      expect(observed.map((event) => event.data)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionID: sourceRoot,
            projectID: destination.id,
            location: { directory: destination.directory },
          }),
        ]),
      )
      expect(
        yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.type, EventV2.versionedType(SessionEvent.Moved.type, 1)))
          .all()
          .pipe(Effect.orDie),
      ).toHaveLength(3)

      expect(yield* projects.attachFolder({ projectID: source.id, folder: repo.path })).toEqual(result)
      expect(
        yield* Effect.flip(projects.attachFolder({ projectID: source.id, folder: conflictingRepo.path })),
      ).toBeInstanceOf(Project.NotFoundError)
    }),
  )

  it.live("rejects another folderless project's private directory", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      const source = yield* Effect.acquireRelease(projects.create({ name: "Source" }), (project) =>
        Effect.promise(() => fs.rm(project.directory, { recursive: true, force: true })),
      )
      const destination = yield* Effect.acquireRelease(projects.create({ name: "Destination" }), (project) =>
        Effect.promise(() => fs.rm(project.directory, { recursive: true, force: true })),
      )

      expect(
        yield* Effect.flip(projects.attachFolder({ projectID: source.id, folder: destination.directory })),
      ).toBeInstanceOf(Project.InvalidFolderError)
      expect(yield* projects.isFolderless(source.id)).toBe(true)
      expect(yield* projects.isFolderless(destination.id)).toBe(true)
    }),
  )

  it.live("reconciles an exact retry when the attached project had no sessions", () =>
    Effect.gen(function* () {
      const destination = yield* temporaryRepo
      const projects = yield* Project.Service
      const source = yield* Effect.acquireRelease(projects.create({ name: "Empty" }), (project) =>
        Effect.promise(() => fs.rm(project.directory, { recursive: true, force: true })),
      )

      const attached = yield* projects.attachFolder({ projectID: source.id, folder: destination.path })

      expect(attached.sessionIDs).toEqual([])
      expect(yield* projects.attachFolder({ projectID: source.id, folder: destination.path })).toEqual(attached)
    }),
  )

  it.live("rolls back session moves when source deletion fails", () =>
    Effect.gen(function* () {
      const destination = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const projects = yield* Project.Service
      const source = yield* Effect.acquireRelease(projects.create({ name: "Rollback" }), (project) =>
        Effect.promise(() => fs.rm(project.directory, { recursive: true, force: true })),
      )
      const sessionID = SessionV2.ID.create()
      yield* db.insert(SessionTable).values(session(sessionID, source.id, source.directory, "")).run().pipe(Effect.orDie)
      yield* db
        .run(`CREATE TRIGGER reject_folderless_delete BEFORE DELETE ON project
          WHEN OLD.id = '${source.id}' BEGIN SELECT RAISE(ABORT, 'reject delete'); END;`)
        .pipe(Effect.orDie)
      const observed = new Array<EventV2.Payload>()
      yield* events.listen((event) => Effect.sync(() => observed.push(event)))

      expect(Exit.isFailure(yield* projects.attachFolder({ projectID: source.id, folder: destination.path }).pipe(Effect.exit))).toBe(
        true,
      )
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
      expect(row).toMatchObject({ project_id: source.id, directory: source.directory })
      expect(yield* projects.isFolderless(source.id)).toBe(true)
      expect(yield* db.select().from(EventTable).all().pipe(Effect.orDie)).toEqual([])
      expect(observed).toEqual([])
    }),
  )
})

function session(id: SessionV2.ID, projectID: Project.ID, directory: AbsolutePath, subpath: string) {
  return { id, project_id: projectID, directory, path: subpath || null, slug: id, title: id, version: "test" }
}

function epoch(sessionID: SessionV2.ID) {
  return { session_id: sessionID, baseline: "test", baseline_seq: 0, snapshot: {} }
}

const temporaryRepo = Effect.acquireRelease(
  Effect.promise(async () => {
    const repo = await tmpdir()
    await $`git init`.cwd(repo.path).quiet()
    await $`git config core.fsmonitor false`.cwd(repo.path).quiet()
    await $`git config commit.gpgsign false`.cwd(repo.path).quiet()
    await $`git config user.email test@hena.test`.cwd(repo.path).quiet()
    await $`git config user.name Test`.cwd(repo.path).quiet()
    await $`git commit --allow-empty -m root`.cwd(repo.path).quiet()
    return repo
  }),
  (repo) => Effect.promise(() => repo[Symbol.asyncDispose]()),
)
