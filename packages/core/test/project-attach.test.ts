import { describe, expect } from "bun:test"
import { mkdir, readFile, rename, unlink } from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Layer } from "effect"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { Location } from "@hena/core/location"
import { ProjectV2 } from "@hena/core/project"
import { ProjectAttach } from "@hena/core/project/attach"
import { ProjectTable } from "@hena/core/project/sql"
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
  it.effect("attaches a chat Project and removes its manifest", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      yield* Effect.promise(() => Bun.write(path.join(setup.target, "existing.txt"), "occupied"))
      expect(
        yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target }).pipe(Effect.flip),
      ).toMatchObject({ reason: "target_not_empty" })

      yield* Effect.promise(() => unlink(path.join(setup.target, "existing.txt")))
      yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target })

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
      expect(yield* Effect.promise(() => Bun.file(setup.manifest).exists())).toBe(false)
    }),
  )

  it.effect("rolls back files and Session moves when attach fails", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const events = yield* EventV2.Service
      yield* events.project(SessionEvent.Moved, (event) =>
        event.data.sessionID === setup.sibling.id && event.data.location.directory.startsWith(setup.target)
          ? Effect.die("injected attach failure")
          : Effect.void,
      )

      expect(
        yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target }).pipe(Effect.flip),
      ).toMatchObject({ reason: "move_failed" })
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
      expect(yield* Effect.promise(() => Bun.file(setup.manifest).exists())).toBe(false)
    }),
  )

  it.effect("recovers an interrupted attach from its filesystem manifest", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const id = crypto.randomUUID()
      const backup = AbsolutePath.make(`${setup.source}.hena-attach-${id}`)
      const session = (yield* setup.db
        .select({ directory: SessionTable.directory, path: SessionTable.path })
        .from(SessionTable)
        .where(eq(SessionTable.id, setup.created.id))
        .get()
        .pipe(Effect.orDie))!
      yield* Effect.promise(async () => {
        await Bun.write(path.join(setup.source, `.hena-attach-${id}`), id)
        await rename(setup.source, backup)
        await Bun.write(path.join(setup.target, "notes.txt"), "chat")
        await Bun.write(path.join(setup.target, `.hena-attach-${id}`), id)
        await Bun.write(
          setup.manifest,
          JSON.stringify({
            version: 1,
            id,
            projectID: setup.created.projectID,
            source: setup.source,
            target: setup.target,
            targetExisted: true,
            sessions: [{ id: setup.created.id, directory: session.directory, path: session.path, workspaceID: null }],
          }),
        )
      })
      yield* (yield* EventV2.Service).publish(
        SessionEvent.Moved,
        {
          sessionID: setup.created.id,
          timestamp: yield* DateTime.now,
          location: Location.Ref.make({ directory: setup.target }),
        },
        {
          id: EventV2.ID.make(`evt_attach_${id}_${setup.created.id}_forward`),
          location: Location.Ref.make({ directory: setup.target }),
        },
      )

      yield* setup.attach.recover(setup.manifest)

      expect((yield* setup.sessions.get(setup.created.id)).location.directory).toBe(setup.source)
      expect(yield* Effect.promise(() => readFile(path.join(setup.source, "notes.txt"), "utf8"))).toBe("chat")
      expect(yield* Effect.promise(() => Bun.file(setup.manifest).exists())).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(setup.target, "notes.txt")).exists())).toBe(false)
      expect(
        yield* Effect.promise(() => readFile(path.join(`${setup.target}.hena-recovered-${id}`, "notes.txt"), "utf8")),
      ).toBe("chat")
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
    return {
      source,
      target,
      sessions,
      created,
      sibling,
      db,
      attach: yield* ProjectAttach.Service,
      manifest: AbsolutePath.make(path.join(tmp.path, `.hena-attach-${created.projectID}.json`)),
    }
  })
}
