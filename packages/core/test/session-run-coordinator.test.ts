import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { SessionRunCoordinator } from "@hena/core/session/run-coordinator"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

describe("SessionRunCoordinator", () => {
  it.effect("joins concurrent resumes for one key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.sync(() => runs++).pipe(Effect.andThen(Deferred.await(gate))),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow

        expect(runs).toBe(1)
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("joins a wake-started execution without forcing a successor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const forces: boolean[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (_key, force) =>
            Effect.sync(() => forces.push(force)).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(gate)),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(resumed)

        expect(forces).toEqual([false])
      }),
    ),
  )

  it.effect("starts execution when woken while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drained = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Deferred.succeed(drained, undefined) })

        yield* coordinator.wake("session")
        yield* Deferred.await(drained)
      }),
    ),
  )

  it.effect("snapshots only active executions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (key: string) =>
            Deferred.succeed(key === "first" ? firstStarted : secondStarted, undefined).pipe(
              Effect.andThen(Deferred.await(key === "first" ? firstGate : secondGate)),
            ),
        })

        expect(Array.from(yield* coordinator.active)).toEqual([])
        const first = yield* coordinator.run("first").pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        expect(Array.from(yield* coordinator.active)).toEqual(["first"])

        const second = yield* coordinator.run("second").pipe(Effect.forkChild)
        yield* Deferred.await(secondStarted).pipe(Effect.timeoutOrElse({ duration: "100 millis", orElse: () => Effect.die("second did not start") }))
        expect(Array.from(yield* coordinator.active)).toEqual(["first", "second"])

        yield* Deferred.succeed(firstGate, undefined)
        yield* Fiber.join(first)
        expect(Array.from(yield* coordinator.active)).toEqual(["second"])
        yield* Deferred.succeed(secondGate, undefined)
        yield* Fiber.join(second)
        expect(Array.from(yield* coordinator.active)).toEqual([])
      }),
    ),
  )

  it.effect("cleans active executions after failure and defect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = new Error("failed")
        const defect = new Error("defect")
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (key: string) => (key === "failure" ? Effect.fail(failure) : Effect.die(defect)),
        })

        const failed = yield* coordinator.run("failure").pipe(Effect.exit)
        expect(Exit.isFailure(failed) && Cause.hasFails(failed.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])

        const died = yield* coordinator.run("defect").pipe(Effect.exit)
        expect(Exit.isFailure(died) && Cause.hasDies(died.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])
      }),
    ),
  )

  it.effect("settles advisory status after the coordinator releases ownership", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const settled = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Deferred.succeed(started, undefined),
          onStart: () => Effect.void,
          onSettle: (key, exit) =>
            Effect.sync(() => {
              expect(key).toBe("session")
              expect(Exit.isSuccess(exit)).toBeTrue()
            }).pipe(Effect.andThen(Deferred.succeed(settled, undefined))),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        yield* Deferred.await(settled)
        expect(Array.from(yield* coordinator.active)).toEqual([])
      }),
    ),
  )

  it.effect("keeps one lifecycle across successful coalesced wakes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const states: string[] = []
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => {
            runs += 1
            return runs === 1
              ? Deferred.await(firstGate)
              : Deferred.succeed(secondStarted, undefined)
          },
          onStart: () => Effect.sync(() => states.push("running")),
          onSettle: (_key, exit) =>
            Effect.sync(() => states.push(Exit.isSuccess(exit) ? "idle" : "failed")),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* Fiber.join(resumed)
        yield* Effect.yieldNow

        expect(states).toEqual(["running", "idle"])
      }),
    ),
  )

  it.effect("cleans active executions when its scope closes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const coordinator = yield* Effect.scoped(
        Effect.gen(function* () {
          const coordinator = yield* SessionRunCoordinator.make({
            drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          })
          yield* coordinator.wake("session")
          yield* Deferred.await(started)
          expect(Array.from(yield* coordinator.active)).toEqual(["session"])
          return coordinator
        }),
      )

      expect(Array.from(yield* coordinator.active)).toEqual([])
    }),
  )

  it.effect("does not start a successor until async settlement completes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const settleGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const states: string[] = []
        let secondIsStarted = false
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => {
            runs += 1
            return runs === 1
              ? Deferred.succeed(firstStarted, undefined)
              : Effect.sync(() => {
                  secondIsStarted = true
                }).pipe(Effect.andThen(Deferred.succeed(secondStarted, undefined)))
          },
          onStart: () => Effect.sync(() => states.push("running")),
          onSettle: (_key, exit) =>
            Deferred.await(settleGate).pipe(Effect.andThen(Effect.sync(() => states.push(Exit.isSuccess(exit) ? "idle" : "failed")))),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Effect.yieldNow
        expect(secondIsStarted).toBeFalse()
        expect(states).toEqual(["running"])
        yield* Deferred.succeed(settleGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* Effect.yieldNow

        expect(states).toEqual(["running", "idle", "running", "idle"])
      }),
    ),
  )

  it.effect("coalesces wakes received during active execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstGate)))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        yield* Effect.all([coordinator.wake("session"), coordinator.wake("session"), coordinator.wake("session")], {
          concurrency: "unbounded",
        })
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* Fiber.join(resumed)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("runs again when woken during the follow-up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const thirdStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(firstGate)
                  : run === 2
                    ? Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate)))
                    : Deferred.succeed(thirdStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(secondGate, undefined)
        yield* Deferred.await(thirdStarted)
        yield* Fiber.join(resumed)

        expect(runs).toBe(3)
      }),
    ),
  )

  it.effect("does nothing when interrupted while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.void })
        yield* coordinator.interrupt("session")
      }),
    ),
  )

  it.effect("interrupts active execution and clears its pending wake", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* coordinator.wake("session")
        yield* coordinator.interrupt("session")
        yield* Deferred.await(interrupted)

        const exit = yield* Fiber.await(resumed)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("runs a wake registered during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                      ),
                    )
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(interrupt)
        yield* Deferred.await(secondStarted)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("starts a resume registered during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const forces: boolean[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (_key, force) => {
            forces.push(force)
            return forces.length === 1
              ? Deferred.succeed(firstStarted, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() =>
                    Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                  ),
                )
              : Deferred.succeed(secondStarted, undefined)
          },
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Effect.all([Fiber.join(interrupt), Fiber.join(resumed)])
        yield* Deferred.await(secondStarted)

        expect(forces).toEqual([false, true])
      }),
    ),
  )

  it.effect("starts one follow-up when a wake races with failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const failure = new Error("failed")
        let runs = 0
        const states: string[] = []
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(gate).pipe(Effect.andThen(Effect.fail(failure)))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
          onStart: () => Effect.sync(() => states.push("running")),
          onSettle: (_key, exit) => Effect.sync(() => states.push(Exit.isSuccess(exit) ? "idle" : "failed")),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(gate, undefined)

        expect(yield* Fiber.join(resumed).pipe(Effect.flip)).toBe(failure)
        yield* Deferred.await(secondStarted)
        yield* Effect.yieldNow
        expect(states).toEqual(["running", "failed", "running", "idle"])
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("does not cancel execution when a joined waiter is interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.sync(() => runs++).pipe(Effect.andThen(Deferred.await(gate))),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Fiber.interrupt(second)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)

        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("waits for active cleanup and serializes concurrent mutations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const firstStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const order: string[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Effect.sync(() => order.push("cleanup"))),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        const first = yield* coordinator
          .serialize(
            "session",
            Effect.sync(() => order.push("first")).pipe(
              Effect.andThen(Deferred.succeed(firstStarted, undefined)),
              Effect.andThen(Deferred.await(firstGate)),
            ),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        const second = yield* coordinator
          .serialize("session", Effect.sync(() => order.push("second")))
          .pipe(Effect.forkChild)

        yield* Effect.yieldNow
        expect(order).toEqual(["cleanup", "first"])
        yield* Deferred.succeed(firstGate, undefined)
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        expect(order).toEqual(["cleanup", "first", "second"])
      }),
    ),
  )

  it.effect("runs ordinary mutations without interrupting or joining active execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        let interrupted = false
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.onInterrupt(() => Effect.sync(() => (interrupted = true))),
            ),
        })

        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(started)
        expect(yield* coordinator.mutate("session", Effect.succeed("recorded"))).toBe("recorded")
        expect(interrupted).toBeFalse()
        expect(Array.from(yield* coordinator.active)).toEqual(["session"])

        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(run)
      }),
    ),
  )

  it.effect("fences ordinary mutations behind a competing destructive mutation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const cleanup = yield* Deferred.make<void>()
        const destructiveStarted = yield* Deferred.make<void>()
        const destructiveGate = yield* Deferred.make<void>()
        const order: string[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(cleanup, undefined)),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        const destructive = yield* coordinator
          .serialize(
            "session",
            Effect.sync(() => order.push("revert")).pipe(
              Effect.andThen(Deferred.succeed(destructiveStarted, undefined)),
              Effect.andThen(Deferred.await(destructiveGate)),
            ),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(cleanup)
        yield* Deferred.await(destructiveStarted)
        const admission = yield* coordinator
          .mutate("session", Effect.sync(() => order.push("admit")))
          .pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(order).toEqual(["revert"])

        yield* Deferred.succeed(destructiveGate, undefined)
        yield* Effect.all([Fiber.join(destructive), Fiber.join(admission)])
        expect(order).toEqual(["revert", "admit"])
      }),
    ),
  )

  it.effect("does not deadlock wakes or resume joins behind a destructive mutation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mutationStarted = yield* Deferred.make<void>()
        const mutationGate = yield* Deferred.make<void>()
        const drained = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: () => Deferred.succeed(drained, undefined),
        })

        const destructive = yield* coordinator
          .serialize(
            "session",
            Deferred.succeed(mutationStarted, undefined).pipe(
              Effect.andThen(coordinator.wake("session")),
              Effect.andThen(Deferred.await(mutationGate)),
            ),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(mutationStarted)
        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(mutationGate, undefined)

        yield* Deferred.await(drained)
        yield* Effect.all([Fiber.join(destructive), Fiber.join(resumed)])
      }),
    ),
  )

  it.effect("runs different keys concurrently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const bothStarted = yield* Deferred.make<void>()
        let active = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++active).pipe(
              Effect.tap(() => (active === 2 ? Deferred.succeed(bothStarted, undefined) : Effect.void)),
              Effect.andThen(Deferred.await(gate)),
            ),
        })

        const first = yield* coordinator.run("first").pipe(Effect.forkChild)
        const second = yield* coordinator.run("second").pipe(Effect.forkChild)
        yield* Deferred.await(bothStarted)
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      }),
    ),
  )

  it.effect("trampolines synchronous self-waking execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const limit = 20_000
        const completed = yield* Deferred.make<void>()
        let runs = 0
        let wake: (key: string) => Effect.Effect<void> = () => Effect.void
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (key) =>
            Effect.sync(() => ++runs).pipe(
              Effect.tap((run) => (run < limit ? wake(key) : Deferred.succeed(completed, undefined))),
              Effect.asVoid,
            ),
        })
        wake = coordinator.wake

        yield* coordinator.wake("session")
        yield* Deferred.await(completed)

        expect(runs).toBe(limit)
      }),
    ),
  )
})
