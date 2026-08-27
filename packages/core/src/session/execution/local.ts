import { Cause, Effect, Layer } from "effect"
import { and, eq, notInArray } from "drizzle-orm"
import { Database } from "../../database/database"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { ProjectAttachOperationTable, ProjectTable } from "../../project/sql"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        const attaching = yield* db
          .select({ id: ProjectAttachOperationTable.id })
          .from(ProjectAttachOperationTable)
          .innerJoin(ProjectTable, eq(ProjectTable.id, ProjectAttachOperationTable.project_id))
          .where(
            and(
              eq(ProjectAttachOperationTable.project_id, session.projectID),
              eq(ProjectTable.mode, "chat"),
              notInArray(ProjectAttachOperationTable.phase, ["completed", "rolled_back"]),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (attaching) return
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [Database.node, SessionStore.node, LocationServiceMap.node],
})

export * as SessionExecutionLocal from "./local"
