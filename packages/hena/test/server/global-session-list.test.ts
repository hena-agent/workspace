import { describe, expect } from "bun:test"
import { LayerNode } from "@hena/core/effect/layer-node"
import { SessionProjector } from "@hena/core/session/projector"
import { Deferred, Effect } from "effect"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
import { CrossSpawnSpawner } from "@hena/core/cross-spawn-spawner"
import { Database } from "@hena/core/database/database"
import { ProjectTable } from "@hena/core/project/sql"
import { eq } from "drizzle-orm"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([SessionNs.node, SessionProjector.node, Project.node, CrossSpawnSpawner.node, Database.node]),
  ),
)

const withSession = (input?: Parameters<SessionNs.Interface["create"]>[0]) =>
  Effect.acquireRelease(SessionNs.use.create(input), (created) =>
    SessionNs.Service.use((session) => session.remove(created.id).pipe(Effect.ignore)),
  )

describe("session.listGlobal", () => {
  it.instance(
    "renders rooted project metadata and folderless projects as null",
    () =>
      Effect.gen(function* () {
        const first = yield* TestInstance
        const second = yield* tmpdirScoped({ git: true })
        const third = yield* tmpdirScoped({ git: true })

        const firstSession = yield* withSession({ title: "first-session" })
        const secondSession = yield* withSession({ title: "second-session" }).pipe(provideInstance(second))
        const thirdSession = yield* withSession({ title: "third-session" }).pipe(provideInstance(third))

        const { db } = yield* Database.Service
        yield* db
          .update(ProjectTable)
          .set({ worktree: null })
          .where(eq(ProjectTable.id, thirdSession.projectID))
          .run()
          .pipe(Effect.orDie)

        const sessions = yield* SessionNs.Service.use((session) => session.listGlobal({ limit: 200 }))
        const firstItem = sessions.find((session) => session.id === firstSession.id)
        const secondItem = sessions.find((session) => session.id === secondSession.id)
        const thirdItem = sessions.find((session) => session.id === thirdSession.id)

        expect(firstItem?.project).toMatchObject({ id: firstSession.projectID, worktree: first.directory })
        expect(secondItem?.project).toMatchObject({ id: secondSession.projectID, worktree: second })
        expect(thirdItem?.project).toBeNull()
      }),
    { git: true },
  )

  it.instance(
    "excludes archived sessions by default",
    () =>
      Effect.gen(function* () {
        const archived = yield* withSession({ title: "archived-session" })

        yield* SessionNs.Service.use((session) => session.setArchived({ sessionID: archived.id, time: Date.now() }))

        const sessions = yield* SessionNs.Service.use((session) => session.listGlobal({ limit: 200 }))
        const ids = sessions.map((session) => session.id)

        expect(ids).not.toContain(archived.id)

        const allSessions = yield* SessionNs.Service.use((session) =>
          session.listGlobal({ limit: 200, archived: true }),
        )
        const allIds = allSessions.map((session) => session.id)

        expect(allIds).toContain(archived.id)
      }),
    { git: true },
  )

  it.instance(
    "supports cursor pagination",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance

        const first = yield* withSession({ title: "page-one" })
        const ready = yield* Deferred.make<void>()
        yield* Deferred.succeed(ready, undefined).pipe(Effect.delay("5 millis"), Effect.forkScoped)
        yield* Deferred.await(ready).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.fail(new Error("timed out waiting between session creates")),
          }),
        )
        const second = yield* withSession({ title: "page-two" })

        const page = yield* SessionNs.Service.use((session) =>
          session.listGlobal({ directory: test.directory, limit: 1 }),
        )
        expect(page.length).toBe(1)
        expect(page[0].id).toBe(second.id)

        const next = yield* SessionNs.Service.use((session) =>
          session.listGlobal({ directory: test.directory, limit: 10, cursor: page[0].time.updated }),
        )
        const ids = next.map((session) => session.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      }),
    { git: true },
  )
})
