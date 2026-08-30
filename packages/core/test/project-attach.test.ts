import { describe, expect } from "bun:test"
import { lstat, mkdir, readFile, readdir, readlink, rename, symlink, unlink } from "fs/promises"
import path from "path"
import { and, eq } from "drizzle-orm"
import { DateTime, Effect, Exit, Layer } from "effect"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { Location } from "@hena/core/location"
import { ProjectV2 } from "@hena/core/project"
import { ProjectAttach } from "@hena/core/project/attach"
import { ProjectAttachState } from "@hena/core/project/attach-state"
import { ProjectDirectoryTable, ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { SessionEvent } from "@hena/core/session/event"
import { SessionExecution } from "@hena/core/session/execution"
import { Prompt } from "@hena/core/session/prompt"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionInputTable, SessionTable } from "@hena/core/session/sql"
import { SessionStore } from "@hena/core/session/store"
import { Hash } from "@hena/core/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    create: (id) => Effect.succeed({ id: id ?? ProjectV2.ID.make("prj_chat"), directory: AbsolutePath.make("/chat") }),
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.make(`prj_${Hash.fast(directory)}`), directory }),
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
      yield* Effect.promise(() => symlink("notes.txt", path.join(setup.source, "linked.txt")))
      yield* Effect.promise(() => Bun.write(path.join(setup.target, "existing.txt"), "occupied"))
      expect(
        yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target }).pipe(Effect.flip),
      ).toMatchObject({ reason: "target_not_empty" })

      yield* Effect.promise(() => unlink(path.join(setup.target, "existing.txt")))
      yield* setup.attach.attach({ projectID: setup.created.projectID, directory: setup.target })
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
      expect((yield* Effect.promise(() => lstat(path.join(setup.target, "linked.txt")))).isSymbolicLink()).toBe(true)
      expect(yield* Effect.promise(() => readlink(path.join(setup.target, "linked.txt")))).toBe("notes.txt")
      expect(yield* Effect.promise(() => readFile(path.join(setup.target, "linked.txt"), "utf8"))).toBe("chat")
      expect(yield* Effect.promise(() => Bun.file(setup.manifest).exists())).toBe(false)
    }),
  )

  it.effect("rejects a target attached to another Project", () =>
    Effect.gen(function* () {
      const first = yield* setupProject({ empty: true })
      const second = yield* setupProject({ empty: true })

      yield* first.attach.attach({ projectID: first.created.projectID, directory: first.target })
      expect(
        yield* second.attach
          .attach({ projectID: second.created.projectID, directory: first.target })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "target_in_use" })
      expect(
        yield* first.db
          .select()
          .from(ProjectDirectoryTable)
          .where(
            and(
              eq(ProjectDirectoryTable.directory, first.target),
              eq(ProjectDirectoryTable.strategy, "attach"),
            ),
          )
          .all(),
      ).toHaveLength(1)
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            first.db
              .insert(ProjectDirectoryTable)
              .values({ project_id: second.created.projectID, directory: first.target, strategy: "attach" })
              .run(),
          ),
        ),
      ).toBe(true)
    }),
  )

  it.effect("rolls back files and Session moves when attach fails", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      const events = yield* EventV2.Service
      yield* events.project(SessionEvent.Moved, (event) =>
        event.data.sessionID === setup.sibling.id && event.data.location.directory.startsWith(setup.target)
          ? Effect.promise(() => Bun.write(path.join(setup.target, "external.txt"), "external")).pipe(
              Effect.andThen(Effect.die("injected attach failure")),
            )
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
      const recovered = (yield* Effect.promise(() => readdir(path.dirname(setup.target)))).find((entry) =>
        entry.startsWith(`${path.basename(setup.target)}.hena-recovered-`),
      )
      expect(recovered).toBeDefined()
      expect(
        yield* Effect.promise(() => readFile(path.join(path.dirname(setup.target), recovered!, "external.txt"), "utf8")),
      ).toBe("external")
      expect(yield* Effect.promise(() => readdir(setup.target))).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(setup.manifest).exists())).toBe(false)
    }),
  )

  it.effect("recovers an interrupted attach from its filesystem manifest", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      yield* Effect.addFinalizer(() => Effect.sync(() => ProjectAttachState.unblock(setup.created.projectID)))
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

  it.effect("rejects prompts while attach is blocked", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => ProjectAttachState.unblock(setup.created.projectID)).pipe(
          Effect.andThen(Effect.promise(() => unlink(setup.manifest)).pipe(Effect.catchCause(() => Effect.void))),
        ),
      )

      ProjectAttachState.block(setup.created.projectID)
      expect(
        yield* setup.sessions
          .prompt({ sessionID: setup.created.id, prompt: Prompt.make({ text: "blocked" }) })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.AttachConflictError" })
      ProjectAttachState.unblock(setup.created.projectID)

      yield* Effect.promise(() => Bun.write(setup.manifest, "{}"))
      expect(
        yield* setup.sessions
          .prompt({ sessionID: setup.created.id, prompt: Prompt.make({ text: "recovering" }) })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.AttachConflictError" })
      expect(
        yield* setup.db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, setup.created.id)).all(),
      ).toEqual([])
    }),
  )

  it.effect("does not delete staging without its ownership marker", () =>
    Effect.gen(function* () {
      const setup = yield* setupProject()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => ProjectAttachState.unblock(setup.created.projectID)).pipe(
          Effect.andThen(Effect.promise(() => unlink(setup.manifest)).pipe(Effect.catchCause(() => Effect.void))),
        ),
      )
      const id = crypto.randomUUID()
      const staging = `${setup.target}.hena-attach-${id}`
      yield* Effect.promise(async () => {
        await Bun.write(path.join(setup.source, `.hena-attach-${id}`), id)
        await Bun.write(path.join(staging, "external.txt"), "external")
        await Bun.write(
          setup.manifest,
          JSON.stringify({
            version: 1,
            id,
            projectID: setup.created.projectID,
            source: setup.source,
            target: setup.target,
            targetExisted: true,
            sessions: [],
          }),
        )
      })

      expect(Exit.isFailure(yield* Effect.exit(setup.attach.recover(setup.manifest)))).toBe(true)
      expect(yield* Effect.promise(() => readFile(path.join(staging, "external.txt"), "utf8"))).toBe("external")
      expect(yield* Effect.promise(() => Bun.file(setup.manifest).exists())).toBe(true)
    }),
  )
})

function setupProject(input: { empty?: boolean } = {}) {
  return Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const source = AbsolutePath.make(path.join(tmp.path, "managed"))
    const target = AbsolutePath.make(path.join(tmp.path, "workspace"))
    yield* Effect.promise(async () => {
      await mkdir(input.empty ? source : path.join(source, "nested"), { recursive: true })
      await mkdir(target)
      if (input.empty) return
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
