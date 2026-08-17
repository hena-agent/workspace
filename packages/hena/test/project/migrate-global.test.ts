import { describe, expect } from "bun:test"
import { Project } from "@/project/project"
import { Database } from "@hena/core/database/database"
import { eq } from "drizzle-orm"
import { SessionTable } from "@hena/core/session/sql"
import { ProjectDirectoryTable, ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { ProjectV2 } from "@hena/core/project"
import { EventV2 } from "@hena/core/event"
import { EventTable } from "@hena/core/event/sql"
import { Location } from "@hena/core/location"
import { SessionV1 } from "@hena/core/v1/session"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { InstanceRef } from "../../src/effect/instance-ref"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { $ } from "bun"
import { tmpdirScoped } from "../fixture/fixture"
import { LayerNode } from "@hena/core/effect/layer-node"
import { CrossSpawnSpawner } from "@hena/core/cross-spawn-spawner"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import path from "path"

const it = testEffect(LayerNode.compile(LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])))
class PublishBarrier extends Context.Service<
  PublishBarrier,
  { started: Deferred.Deferred<void>; release: Deferred.Deferred<void> }
>()("@hena/test/PublishBarrier") {}

const publishBarrierNode = LayerNode.make({
  service: PublishBarrier,
  layer: Layer.effect(
    PublishBarrier,
    Effect.all({ started: Deferred.make<void>(), release: Deferred.make<void>() }).pipe(Effect.map(PublishBarrier.of)),
  ),
  deps: [],
})
const barrierBridgeNode = LayerNode.make({
  service: EventV2Bridge.Service,
  layer: Layer.effect(
    EventV2Bridge.Service,
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const barrier = yield* PublishBarrier
      const first = { pending: true }
      const publish: EventV2.Interface["publish"] = (definition, data, options) =>
        Effect.gen(function* () {
          if (definition.type === SessionV1.Event.Created.type && first.pending) {
            first.pending = false
            yield* Deferred.succeed(barrier.started, undefined)
            yield* Deferred.await(barrier.release)
          }
          return yield* events.publish(definition, data, options)
        })
      return EventV2Bridge.Service.of({ ...events, publish })
    }),
  ).pipe(Layer.provide(LayerNode.compile(EventV2Bridge.node))),
  deps: [publishBarrierNode],
})
const sessionIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Project.node,
      Session.node,
      EventV2Bridge.node,
      SessionProjector.node,
      Database.node,
      CrossSpawnSpawner.node,
      publishBarrierNode,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [EventV2Bridge.node, barrierBridgeNode],
    ],
  ),
)

function legacySessionID() {
  // Global-session migration covers persisted IDs from before prefixed session IDs.
  return crypto.randomUUID() as SessionID
}

function seed(opts: { id: SessionID; dir: string; project: ProjectV2.ID }) {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id,
        project_id: opts.project,
        slug: opts.id,
        directory: opts.dir,
        title: "test",
        version: "0.0.0-test",
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie),
  )
}

function ensureGlobal() {
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({
        id: ProjectV2.ID.global,
        worktree: AbsolutePath.make("/"),
        time_created: Date.now(),
        time_updated: Date.now(),
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie),
  )
}

describe("migrateFromGlobal", () => {
  sessionIt.live("revalidates stale global context before durable session creation", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => $`git init`.cwd(tmp).quiet())
      yield* Effect.promise(() => $`git config user.name "Test"`.cwd(tmp).quiet())
      yield* Effect.promise(() => $`git config user.email "test@hena.test"`.cwd(tmp).quiet())
      yield* Effect.promise(() => $`git config commit.gpgsign false`.cwd(tmp).quiet())
      const projects = yield* Project.Service
      const stale = yield* projects.fromDirectory(tmp)
      expect(stale.project.id).toBe(ProjectV2.ID.global)

      const nestedProjectID = ProjectV2.ID.make("nested-project")
      const nestedRoot = AbsolutePath.make(path.join(tmp, "packages"))
      const nested = AbsolutePath.make(path.join(nestedRoot, "app", "src"))
      const { db } = yield* Database.Service

      const events = yield* EventV2Bridge.Service
      const created = new Array<{ info: Session.Info; location: Location.Info }>()
      const unsubscribe = yield* events.listen((event) => {
        if (event.type === SessionV1.Event.Created.type)
          created.push({
            info: (event.data as typeof SessionV1.Event.Created.data.Type).info as Session.Info,
            location: event.location as Location.Info,
          })
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const forwarded = new Array<GlobalEvent>()
      const listener = (event: GlobalEvent) => {
        if (
          event.payload.type === SessionV1.Event.Created.type ||
          event.payload.syncEvent?.type === `${SessionV1.Event.Created.type}.1`
        )
          forwarded.push(event)
      }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))

      const sessions = yield* Session.Service
      const barrier = yield* PublishBarrier
      const creating = yield* sessions.create({}).pipe(
        Effect.provideService(InstanceRef, {
          directory: nested,
          worktree: stale.sandbox,
          project: stale.project,
        }),
        Effect.forkChild,
      )
      yield* Deferred.await(barrier.started)
      yield* db.transaction(() =>
        Effect.gen(function* () {
          yield* db
            .insert(ProjectTable)
            .values({
              id: nestedProjectID,
              worktree: nestedRoot,
              vcs: "git",
              time_created: Date.now(),
              time_updated: Date.now(),
              sandboxes: [],
            })
            .run()
          yield* db.insert(ProjectDirectoryTable).values({ project_id: nestedProjectID, directory: nestedRoot }).run()
        }),
      )
      yield* Deferred.succeed(barrier.release, undefined)
      const result = yield* Fiber.join(creating)
      const rows = yield* db.select().from(SessionTable).where(eq(SessionTable.id, result.id)).all().pipe(Effect.orDie)
      const durable = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, result.id))
        .all()
        .pipe(Effect.orDie)

      expect(result.projectID).toBe(nestedProjectID)
      expect(result.directory).toBe(nested)
      expect(created).toHaveLength(1)
      expect(created[0]!.info.projectID).toBe(nestedProjectID)
      expect(created[0]!.location.directory).toBe(nested)
      expect(created[0]!.location.project).toEqual({ id: nestedProjectID, directory: nestedRoot })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.project_id).toBe(nestedProjectID)
      expect(durable).toHaveLength(1)
      expect((durable[0]!.data.info as Session.Info).projectID).toBe(nestedProjectID)
      expect(forwarded).toHaveLength(2)
      expect(forwarded.map((item) => item.project)).toEqual([nestedProjectID, nestedProjectID])
    }),
  )

  it.live("migrates global sessions on first project creation", () =>
    Effect.gen(function* () {
      // 1. Start with git init but no commits — creates "global" project row
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => $`git init`.cwd(tmp).quiet())
      yield* Effect.promise(() => $`git config user.name "Test"`.cwd(tmp).quiet())
      yield* Effect.promise(() => $`git config user.email "test@hena.test"`.cwd(tmp).quiet())
      yield* Effect.promise(() => $`git config commit.gpgsign false`.cwd(tmp).quiet())
      const projects = yield* Project.Service
      const { project: pre } = yield* projects.fromDirectory(tmp)
      expect(pre.id).toBe(ProjectV2.ID.global)

      // 2. Seed a session under "global" with matching directory
      const id = legacySessionID()
      yield* seed({ id, dir: path.join(tmp, "nested", "directory"), project: ProjectV2.ID.global })

      // 3. Make a commit so the project gets a real ID
      yield* Effect.promise(() => $`git commit --allow-empty -m "root"`.cwd(tmp).quiet())

      const { project: real } = yield* projects.fromDirectory(tmp)
      expect(real.id).not.toBe(ProjectV2.ID.global)

      // 4. The session should have been migrated to the real project ID
      const row = yield* Database.Service.use(({ db }) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, id)).get().pipe(Effect.orDie),
      )
      expect(row).toBeDefined()
      expect(row!.project_id).toBe(real.id)
    }),
  )

  it.live("migrates global sessions even when project row already exists", () =>
    Effect.gen(function* () {
      // 1. Create a repo with a commit — real project ID created immediately
      const tmp = yield* tmpdirScoped({ git: true })
      const projects = yield* Project.Service
      const { project } = yield* projects.fromDirectory(tmp)
      expect(project.id).not.toBe(ProjectV2.ID.global)

      // 2. Ensure "global" project row exists (as it would from a prior no-git session)
      yield* ensureGlobal()

      // 3. Seed a session under "global" with matching directory.
      //    This simulates a session created before git init that wasn't
      //    present when the real project row was first created.
      const id = legacySessionID()
      yield* seed({ id, dir: tmp, project: ProjectV2.ID.global })

      // 4. Call fromDirectory again — project row already exists,
      //    so the current code skips migration entirely. This is the bug.
      yield* projects.fromDirectory(tmp)

      const row = yield* Database.Service.use(({ db }) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, id)).get().pipe(Effect.orDie),
      )
      expect(row).toBeDefined()
      expect(row!.project_id).toBe(project.id)
    }),
  )

  it.live("does not claim sessions with empty directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const projects = yield* Project.Service
      const { project } = yield* projects.fromDirectory(tmp)
      expect(project.id).not.toBe(ProjectV2.ID.global)

      yield* ensureGlobal()

      // Legacy sessions may lack a directory value.
      // Without a matching origin directory, they should remain global.
      const id = legacySessionID()
      yield* seed({ id, dir: "", project: ProjectV2.ID.global })

      yield* projects.fromDirectory(tmp)

      const row = yield* Database.Service.use(({ db }) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, id)).get().pipe(Effect.orDie),
      )
      expect(row).toBeDefined()
      expect(row!.project_id).toBe(ProjectV2.ID.global)
    }),
  )

  it.live("does not steal sessions from unrelated directories", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const projects = yield* Project.Service
      const { project } = yield* projects.fromDirectory(tmp)
      expect(project.id).not.toBe(ProjectV2.ID.global)

      yield* ensureGlobal()

      // Seed a session under "global" but for a DIFFERENT directory
      const id = legacySessionID()
      yield* seed({ id, dir: `${tmp}-sibling`, project: ProjectV2.ID.global })

      yield* projects.fromDirectory(tmp)
      const row = yield* Database.Service.use(({ db }) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, id)).get().pipe(Effect.orDie),
      )
      expect(row).toBeDefined()
      // Should remain under "global" — not stolen
      expect(row!.project_id).toBe(ProjectV2.ID.global)
    }),
  )
})
