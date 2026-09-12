import { Cause, DateTime, Effect, Exit, Layer } from "effect"
import path from "path"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { ProjectAttachState } from "../../project/attach-state"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { EventV2 } from "../../event"
import { SessionExecutionEvent } from "@hena/schema/session-execution-event"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
export const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
    const publishStatus = (sessionID: SessionSchema.ID, status: SessionExecution.Status) =>
      Effect.gen(function* () {
        yield* events.publish(SessionExecutionEvent.Status, {
          sessionID,
          timestamp: yield* DateTime.now,
          status,
        })
      })
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        if (
          ProjectAttachState.isBlocked(session.projectID) ||
          (yield* fs
            .exists(path.join(global.data, "projects", `.hena-attach-${session.projectID}.json`))
            .pipe(Effect.orDie))
        )
          return
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
        )
      }),
      onStart: (sessionID) => publishStatus(sessionID, { type: "running" }),
      onSettle: (sessionID, exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause))
            return yield* publishStatus(sessionID, { type: "idle" })
          yield* Effect.logError("Failed to drain Session", exit.cause).pipe(Effect.annotateLogs({ sessionID }))
          yield* publishStatus(sessionID, {
            type: "failed",
            error: { type: "unknown", message: "Session execution failed. Check server logs for details." },
          })
        }),
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      mutate: coordinator.mutate,
      serialize: coordinator.serialize,
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [FSUtil.node, Global.node, SessionStore.node, LocationServiceMap.node, EventV2.node],
})

export * as SessionExecutionLocal from "./local"
