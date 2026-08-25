import { describe, expect } from "bun:test"
import { Project } from "@/project/project"
import { Database } from "@hena/core/database/database"
import { eq } from "drizzle-orm"
import { SessionTable } from "@hena/core/session/sql"
import { ProjectDirectoryTable, ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { ProjectV2 } from "@hena/core/project"
import { EventV2 } from "@hena/core/event"
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
import path from "path"

const it = testEffect(LayerNode.compile(LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])))
class PublishBarrier extends Context.Service<
  PublishBarrier,
  { started: ReadonlyArray<Deferred.Deferred<void>>; release: ReadonlyArray<Deferred.Deferred<void>> }
>()("@hena/test/PublishBarrier") {}

const publishBarrierNode = LayerNode.make({
  service: PublishBarrier,
  layer: Layer.effect(
    PublishBarrier,
    Effect.all({
      started: Effect.all([Deferred.make<void>(), Deferred.make<void>()]),
      release: Effect.all([Deferred.make<void>(), Deferred.make<void>()]),
    }).pipe(Effect.map(PublishBarrier.of)),
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
      const attempt = { value: 0 }
      const publish: EventV2.Interface["publish"] = (definition, data, options) =>
        Effect.gen(function* () {
          if (definition.type === SessionV1.Event.Created.type && attempt.value < barrier.started.length) {
            const index = attempt.value++
            yield* Deferred.succeed(barrier.started[index]!, undefined)
            yield* Deferred.await(barrier.release[index]!)
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

function seed(opts: { id: SessionID; dir: string; project: ProjectV2.ID; path?: string }) {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id,
        project_id: opts.project,
        slug: opts.id,
        directory: opts.dir,
        path: opts.path,
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

function seedProject(id: ProjectV2.ID, directory: AbsolutePath) {
  return Database.Service.use(({ db }) =>
    db
      .transaction((d) =>
        Effect.gen(function* () {
          yield* d
            .insert(ProjectTable)
            .values({
              id,
              worktree: directory,
              vcs: "git",
              time_created: Date.now(),
              time_updated: Date.now(),
              sandboxes: [],
            })
            .run()
          yield* d.insert(ProjectDirectoryTable).values({ project_id: id, directory }).run()
        }),
      )
      .pipe(Effect.orDie),
  )
}

describe("migrateFromGlobal", () => {
  sessionIt.live("does not route a reused stale-pruned sandbox path to its former project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const projects = yield* Project.Service
      const main = yield* projects.fromDirectory(tmp)
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-stale-pruned-routing")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${worktree} HEAD`.cwd(tmp).quiet())
      yield* projects.fromDirectory(worktree)
      yield* Effect.promise(() => $`git worktree remove --force ${worktree}`.cwd(tmp).quiet())

      yield* projects.fromDirectory(tmp)
      yield* Effect.promise(() => $`mkdir -p ${worktree}`.quiet())
      const reused = yield* projects.fromDirectory(worktree)
      const creating = yield* (yield* Session.Service).create().pipe(
        Effect.provideService(InstanceRef, {
          directory: worktree,
          worktree: reused.sandbox,
          project: reused.project,
        }),
        Effect.forkChild,
      )
      const barrier = yield* PublishBarrier
      yield* Deferred.await(barrier.started[0]!)
      yield* Deferred.succeed(barrier.release[0]!, undefined)
      const created = yield* Fiber.join(creating)

      expect(main.project.id).not.toBe(ProjectV2.ID.global)
      expect(created.projectID).toBe(ProjectV2.ID.global)
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

  it.live("migrates global sessions to their nearest project directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const projects = yield* Project.Service
      const outer = (yield* projects.fromDirectory(tmp)).project
      const nestedProjectID = ProjectV2.ID.make("existing-nested-project")
      const nestedRoot = AbsolutePath.make(path.join(tmp, "packages"))
      const outerID = legacySessionID()
      const nestedID = legacySessionID()
      const siblingID = legacySessionID()
      const { db } = yield* Database.Service

      yield* seedProject(nestedProjectID, nestedRoot)
      yield* ensureGlobal()
      yield* seed({
        id: outerID,
        dir: path.join(tmp, "apps", "api"),
        project: ProjectV2.ID.global,
        path: "old/outer/path",
      })
      yield* seed({
        id: nestedID,
        dir: path.join(nestedRoot, "app", "src"),
        project: ProjectV2.ID.global,
        path: "old/nested/path",
      })
      yield* seed({
        id: siblingID,
        dir: `${tmp}-sibling`,
        project: ProjectV2.ID.global,
        path: "unchanged",
      })

      yield* projects.fromDirectory(tmp)
      const rows = yield* db.select().from(SessionTable).all().pipe(Effect.orDie)
      const byID = new Map(rows.map((row) => [row.id, row]))

      expect(byID.get(outerID)).toMatchObject({ project_id: outer.id, path: "apps/api" })
      expect(byID.get(nestedID)).toMatchObject({ project_id: nestedProjectID, path: "app/src" })
      expect(byID.get(siblingID)).toMatchObject({ project_id: ProjectV2.ID.global, path: "unchanged" })
    }),
  )

  sessionIt.live("keeps paths relative to an active non-global sandbox", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const projectID = ProjectV2.ID.make("sandbox-project")
      const worktree = AbsolutePath.make(path.join(tmp, "primary"))
      const sandbox = AbsolutePath.make(path.join(tmp, "linked-worktree"))
      const directory = AbsolutePath.make(path.join(sandbox, "src"))
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: projectID,
          worktree,
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [sandbox],
        })
        .run()
        .pipe(Effect.orDie)

      const sessions = yield* Session.Service
      const barrier = yield* PublishBarrier
      const creating = yield* sessions.create({}).pipe(
        Effect.provideService(InstanceRef, {
          directory,
          worktree: sandbox,
          project: {
            id: projectID,
            worktree,
            vcs: "git",
            sandboxes: [sandbox],
            time: { created: Date.now(), updated: Date.now() },
          },
        }),
        Effect.forkChild,
      )
      yield* Deferred.await(barrier.started[0]!)
      yield* Deferred.succeed(barrier.release[0]!, undefined)
      const result = yield* Fiber.join(creating)
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, result.id)).get().pipe(Effect.orDie)

      expect(result.path).toBe("src")
      expect(row?.path).toBe("src")
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
