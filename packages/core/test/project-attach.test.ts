import { describe, expect } from "bun:test"
import { mkdir, readFile, unlink } from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
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
import { SessionExecution } from "@hena/core/session/execution"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionStore } from "@hena/core/session/store"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    create: (id) =>
      Effect.succeed({ id: id ?? ProjectV2.ID.make("prj_chat"), directory: AbsolutePath.make("/chat") }),
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
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const source = AbsolutePath.make(path.join(tmp.path, "managed"))
      const target = AbsolutePath.make(path.join(tmp.path, "workspace"))
      yield* Effect.promise(async () => {
        await mkdir(source)
        await mkdir(target)
        await Bun.write(path.join(source, "notes.txt"), "chat")
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

      const projects = yield* ProjectAttach.Service
      yield* Effect.promise(() => Bun.write(path.join(target, "existing.txt"), "occupied"))
      expect(yield* projects.attach({ projectID: created.projectID, directory: target }).pipe(Effect.flip)).toMatchObject(
        { reason: "target_not_empty" },
      )
      yield* Effect.promise(() => unlink(path.join(target, "existing.txt")))
      yield* projects.attach({ projectID: created.projectID, directory: target })

      expect((yield* sessions.get(created.id)).location.directory).toBe(target)
      expect((yield* sessions.get(sibling.id)).location.directory).toBe(target)
      expect(yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, created.projectID)).get()).toMatchObject({
        worktree: target,
        mode: "workspace",
      })
      expect(yield* Effect.promise(() => readFile(path.join(target, "notes.txt"), "utf8"))).toBe("chat")
    }),
  )
})
