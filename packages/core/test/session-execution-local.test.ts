import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Logger } from "effect"
import { EventV2 } from "@hena/core/event"
import { FSUtil } from "@hena/core/fs-util"
import { Global } from "@hena/core/global"
import { LocationServiceMap } from "@hena/core/location-service-map"
import { SessionExecution } from "@hena/core/session/execution"
import { SessionExecutionLocal } from "@hena/core/session/execution/local"
import { SessionSchema } from "@hena/core/session/schema"
import { SessionStore } from "@hena/core/session/store"

test.each(["failure", "interruption"])(
  "local execution publishes %s without retaining terminal status",
  async (ending) => {
    const statuses: unknown[] = []
    const logs: string[] = []
    const started = Deferred.makeUnsafe<void>()
    const gate = Deferred.makeUnsafe<void>()
    const id = SessionSchema.ID.make("ses_execution")
    await Effect.gen(function* () {
      const execution = yield* SessionExecution.Service
      const run = yield* execution.resume(id).pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(started)
      expect(Array.from(yield* execution.active)).toEqual([id])
      expect(statuses).toEqual([{ type: "running" }])
      if (ending === "interruption") yield* execution.interrupt(id)
      else yield* Deferred.succeed(gate, undefined)
      const exit = yield* Fiber.join(run)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Array.from(yield* execution.active)).toEqual([])
      expect(statuses).toEqual([
        { type: "running" },
        ending === "interruption"
          ? { type: "idle" }
          : {
              type: "failed",
              error: { type: "unknown", message: "Session execution failed. Check server logs for details." },
            },
      ])
      if (ending === "failure") {
        expect(JSON.stringify(statuses)).not.toContain("private diagnostic")
        expect(logs.some((message) => message.includes("private diagnostic"))).toBe(true)
      }
      if (ending === "interruption") expect(logs).toEqual([])
    }).pipe(
      Effect.scoped,
      Effect.provide(
        SessionExecutionLocal.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              // Placement is never reached when store lookup fails or is interrupted.
              Layer.mock(FSUtil.Service, {} as FSUtil.Interface),
              Layer.mock(Global.Service, {} as Parameters<typeof Global.Service.of>[0]),
              Layer.mock(LocationServiceMap.Service, {} as Parameters<typeof LocationServiceMap.Service.of>[0]),
              Layer.mock(SessionStore.Service, {
                get: () =>
                  Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Deferred.await(gate)),
                    Effect.andThen(Effect.die(new Error("private diagnostic"))),
                  ),
              }),
              Layer.mock(EventV2.Service, {
                publish: (event, data) =>
                  Effect.sync(() => {
                    statuses.push((data as { status: unknown }).status)
                    return { id: EventV2.ID.create(), type: event.type, data }
                  }),
              }),
            ),
          ),
        ),
      ),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            logs.push(Cause.pretty(options.cause))
          }),
        ]),
      ),
      Effect.runPromise,
    )
  },
)
