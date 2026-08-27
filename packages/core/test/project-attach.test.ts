import { describe, expect } from "bun:test"
import { mkdir, readFile, unlink } from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Layer } from "effect"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { EventTable } from "@hena/core/event/sql"
import { Location } from "@hena/core/location"
import { ProjectV2 } from "@hena/core/project"
import { ProjectAttach } from "@hena/core/project/attach"
import { ProjectSchema } from "@hena/core/project/schema"
import { ProjectAttachOperationTable, ProjectAttachSessionTable, ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { SessionEvent } from "@hena/core/session/event"
import { SessionExecution } from "@hena/core/session/execution"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionTable } from "@hena/core/session/sql"
import { SessionStore } from "@hena/core/session/store"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    create: (id) => Effect.succeed({ id: id ?? ProjectV2.ID.make("prj_chat"), directory: AbsolutePath.make("/chat") }),
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      ProjectAttach.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

describe("ProjectAttach", () => {
  it.effect("attaches an entire chat project to an empty workspace", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      yield* Effect.promise(() => Bun.write(path.join(setup.target, "existing.txt"), "occupied"))
      expect(
        yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target }).pipe(Effect.flip),
      ).toMatchObject({ reason: "target_not_empty" })
      expect(yield* setup.attach.get(setup.created.projectID)).toBeUndefined()

      yield* Effect.promise(() => unlink(path.join(setup.target, "existing.txt")))
      const operation = yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target })

      expect(operation.phase).toBe("completed")
      expect((yield* setup.sessions.get(setup.created.id)).location.directory).toBe(setup.target)
      expect((yield* setup.sessions.get(setup.sibling.id)).location.directory).toBe(
        AbsolutePath.make(path.join(setup.target, "nested")),
      )
      expect(
        yield* setup.db.select().from(ProjectTable).where(eq(ProjectTable.id, setup.created.projectID)).get(),
      ).toMatchObject({
        worktree: setup.target,
        mode: "workspace",
      })
      expect(yield* Effect.promise(() => readFile(path.join(setup.target, "notes.txt"), "utf8"))).toBe("chat")
      expect(yield* Effect.promise(() => Bun.file(setup.source).exists())).toBe(false)
      expect(yield* setup.attach.get(setup.created.projectID)).toMatchObject({ phase: "completed" })
    }),
  )

  it.effect("rolls back files and Session projections when a forward event fails", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const events = yield* EventV2.Service
      yield* events.project(SessionEvent.Moved, (event) =>
        event.data.sessionID === setup.sibling.id && event.data.location.directory.startsWith(setup.target)
          ? Effect.die("injected attach projection failure")
          : Effect.void,
      )

      expect(
        yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target }).pipe(Effect.flip),
      ).toMatchObject({ reason: "operation_failed" })

      expect((yield* setup.sessions.get(setup.created.id)).location.directory).toBe(setup.source)
      expect((yield* setup.sessions.get(setup.sibling.id)).location.directory).toBe(
        AbsolutePath.make(path.join(setup.source, "nested")),
      )
      expect(
        yield* setup.db.select().from(ProjectTable).where(eq(ProjectTable.id, setup.created.projectID)).get(),
      ).toMatchObject({
        worktree: setup.source,
        mode: "chat",
      })
      expect(yield* Effect.promise(() => readFile(path.join(setup.source, "notes.txt"), "utf8"))).toBe("chat")
      expect(yield* Effect.promise(() => Bun.file(path.join(setup.target, "notes.txt")).exists())).toBe(false)
      expect(yield* setup.attach.get(setup.created.projectID)).toMatchObject({ phase: "rolled_back" })
    }),
  )

  it.effect("rolls back a journaled pre-commit move during startup recovery", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const operation = yield* journalOperation(setup, "target_ready", true)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(setup.source, `.hena-attach-${operation.id}`), operation.id)
        await Bun.write(path.join(setup.target, "notes.txt"), "chat")
        await Bun.write(path.join(setup.target, `.hena-attach-${operation.id}`), operation.id)
      })
      yield* (yield* EventV2.Service).publish(
        SessionEvent.Moved,
        {
          sessionID: setup.created.id,
          timestamp: yield* DateTime.now,
          location: Location.Ref.make({ directory: setup.target }),
        },
        { id: operation.forwardEventID, location: Location.Ref.make({ directory: setup.target }) },
      )

      expect((yield* setup.sessions.get(setup.created.id)).location.directory).toBe(setup.target)
      yield* setup.attach.recoverAll
      expect(yield* setup.attach.get(setup.created.projectID)).toMatchObject({ phase: "rolled_back" })
      expect((yield* setup.sessions.get(setup.created.id)).location.directory).toBe(setup.source)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(setup.source, `.hena-attach-${operation.id}`)).exists()),
      ).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(setup.target, "notes.txt")).exists())).toBe(false)
      expect(
        yield* setup.db.select().from(EventTable).where(eq(EventTable.id, operation.rollbackEventID)).get(),
      ).toBeDefined()
    }),
  )

  it.effect("preserves an ambiguous target for later recovery", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const operation = yield* journalOperation(setup, "target_ready", false)
      yield* Effect.promise(() => Bun.write(path.join(setup.target, "foreign.txt"), "keep"))

      expect(yield* setup.attach.recover(setup.created.projectID).pipe(Effect.flip)).toMatchObject({
        operationID: operation.id,
      })
      expect(yield* Effect.promise(() => readFile(path.join(setup.target, "foreign.txt"), "utf8"))).toBe("keep")
      expect(yield* setup.attach.get(setup.created.projectID)).toMatchObject({ phase: "recovery_required" })

      yield* Effect.promise(() => Bun.write(path.join(setup.target, `.hena-attach-${operation.id}`), operation.id))
      expect(yield* setup.attach.recover(setup.created.projectID)).toMatchObject({ phase: "rolled_back" })
      expect(yield* Effect.promise(() => Bun.file(setup.target).exists())).toBe(false)
    }),
  )

  it.effect("finishes source cleanup after the logical commit point", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const operation = yield* journalOperation(setup, "committed", false)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(setup.source, `.hena-attach-${operation.id}`), operation.id)
        await Bun.write(path.join(setup.target, "notes.txt"), "chat")
        await Bun.write(path.join(setup.target, `.hena-attach-${operation.id}`), operation.id)
      })
      yield* setup.db
        .update(ProjectTable)
        .set({ worktree: setup.target, mode: "workspace" })
        .where(eq(ProjectTable.id, setup.created.projectID))
        .run()
        .pipe(Effect.orDie)

      expect(yield* setup.attach.recover(setup.created.projectID)).toMatchObject({ phase: "completed" })
      expect(yield* Effect.promise(() => Bun.file(setup.source).exists())).toBe(false)
      expect(yield* Effect.promise(() => readFile(path.join(setup.target, "notes.txt"), "utf8"))).toBe("chat")
      expect(
        yield* Effect.promise(() => Bun.file(path.join(setup.target, `.hena-attach-${operation.id}`)).exists()),
      ).toBe(false)
    }),
  )

  it.effect("does not delete an unowned source during deferred cleanup", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const operation = yield* journalOperation(setup, "committed", false)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(setup.target, "notes.txt"), "chat")
        await Bun.write(path.join(setup.target, `.hena-attach-${operation.id}`), operation.id)
      })
      yield* setup.db
        .update(ProjectTable)
        .set({ worktree: setup.target, mode: "workspace" })
        .where(eq(ProjectTable.id, setup.created.projectID))
        .run()
        .pipe(Effect.orDie)

      expect(yield* setup.attach.recover(setup.created.projectID).pipe(Effect.flip)).toMatchObject({
        operationID: operation.id,
      })
      expect(yield* Effect.promise(() => readFile(path.join(setup.source, "notes.txt"), "utf8"))).toBe("chat")
      expect(yield* Effect.promise(() => readFile(path.join(setup.target, "notes.txt"), "utf8"))).toBe("chat")
      expect(yield* setup.attach.get(setup.created.projectID)).toMatchObject({ phase: "recovery_required" })
    }),
  )

  it.effect("does not recover an orphaned operation against the filesystem", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const operation = yield* journalOperation(setup, "target_ready", false)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(setup.target, "notes.txt"), "chat")
        await Bun.write(path.join(setup.target, `.hena-attach-${operation.id}`), operation.id)
      })
      yield* setup.db.delete(ProjectTable).where(eq(ProjectTable.id, setup.created.projectID)).run().pipe(Effect.orDie)

      yield* setup.attach.recoverAll
      expect(
        yield* setup.db
          .select()
          .from(ProjectAttachOperationTable)
          .where(eq(ProjectAttachOperationTable.id, operation.id))
          .get(),
      ).toMatchObject({ phase: "recovery_required" })
      expect(yield* Effect.promise(() => readFile(path.join(setup.source, "notes.txt"), "utf8"))).toBe("chat")
      expect(yield* Effect.promise(() => readFile(path.join(setup.target, "notes.txt"), "utf8"))).toBe("chat")
    }),
  )

  it.effect("serializes concurrent attaches for one project", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const secondTarget = AbsolutePath.make(path.join(path.dirname(setup.target), "workspace-2"))
      yield* Effect.promise(() => mkdir(secondTarget))
      const exits = yield* Effect.all(
        [
          setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target }).pipe(Effect.exit),
          setup.attach.attach({ projectID: setup.created.projectID, directory: secondTarget }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )

      expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1)
      expect(exits.filter((exit) => exit._tag === "Failure")).toHaveLength(1)
      const project = yield* setup.db
        .select()
        .from(ProjectTable)
        .where(eq(ProjectTable.id, setup.created.projectID))
        .get()
      expect(project).toBeDefined()
      expect([setup.target, secondTarget]).toContain(project!.worktree)
      expect(project?.mode).toBe("workspace")
    }),
  )
})

function setupProject() {
  return Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const source = AbsolutePath.make(path.join(tmp.path, "managed"))
    const target = AbsolutePath.make(path.join(tmp.path, "workspace"))
    yield* Effect.promise(async () => {
      await mkdir(path.join(source, "nested"), { recursive: true })
      await mkdir(target)
      await Bun.write(path.join(source, "notes.txt"), "chat")
      await Bun.write(path.join(source, "nested", "nested.txt"), "nested")
    })

    const sessions = yield* SessionV2.Service
    const created = yield* sessions.create({ location: Location.Ref.make({ directory: source }) })
    const sibling = yield* sessions.create({ location: Location.Ref.make({ directory: source }) })
    const { db } = yield* Database.Service
    yield* db
      .update(ProjectTable)
      .set({ worktree: source, mode: "chat" })
      .where(eq(ProjectTable.id, created.projectID))
      .run()
      .pipe(Effect.orDie)
    yield* db
      .update(SessionTable)
      .set({ directory: path.join(source, "nested"), path: "nested" })
      .where(eq(SessionTable.id, sibling.id))
      .run()
      .pipe(Effect.orDie)

    return { source, target, sessions, created, sibling, db, attach: yield* ProjectAttach.Service }
  })
}

function journalOperation(
  setup: Effect.Success<ReturnType<typeof setupProject>>,
  phase: ProjectSchema.AttachPhase,
  targetExisted: boolean,
) {
  return Effect.gen(function* () {
    const id = ProjectSchema.AttachOperationID.create()
    const forwardEventID = EventV2.ID.make(`evt_attach_${id}_${setup.created.id}_forward`)
    const rollbackEventID = EventV2.ID.make(`evt_attach_${id}_${setup.created.id}_rollback`)
    const session = (yield* setup.db
      .select({
        directory: SessionTable.directory,
        path: SessionTable.path,
        workspaceID: SessionTable.workspace_id,
      })
      .from(SessionTable)
      .where(eq(SessionTable.id, setup.created.id))
      .get()
      .pipe(Effect.orDie))!
    yield* setup.db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .insert(ProjectAttachOperationTable)
            .values({
              id,
              project_id: setup.created.projectID,
              source: setup.source,
              target: setup.target,
              staging: AbsolutePath.make(`${setup.target}.hena-attach-${id}`),
              target_existed: targetExisted,
              phase,
            })
            .run()
          yield* tx
            .insert(ProjectAttachSessionTable)
            .values({
              operation_id: id,
              session_id: setup.created.id,
              directory: AbsolutePath.make(session.directory),
              path: session.path,
              workspace_id: session.workspaceID,
              forward_event_id: forwardEventID,
              rollback_event_id: rollbackEventID,
            })
            .run()
        }),
      )
      .pipe(Effect.orDie)
    return { id, forwardEventID, rollbackEventID }
  })
}
