export * as SessionRunCoordinator from "./run-coordinator"

import { Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"
import { KeyedMutex } from "../effect/keyed-mutex"

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E> {
  /** Snapshots keys with an execution owned by this coordinator. */
  readonly active: Effect.Effect<ReadonlySet<Key>>
  /** Starts execution while idle or joins the active execution. */
  readonly run: (key: Key) => Effect.Effect<void, E>
  /** Registers one coalesced follow-up after newly recorded work. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Stops active execution and waits for its cleanup. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
  /** Holds the mutation gate without disturbing active execution. */
  readonly mutate: <A, E2, R>(key: Key, effect: Effect.Effect<A, E2, R>) => Effect.Effect<A, E2, R>
  /** Stops execution and holds the key while a mutation is recorded. */
  readonly serialize: <A, E2, R>(key: Key, effect: Effect.Effect<A, E2, R>) => Effect.Effect<A, E2, R>
}

type Entry<E> = {
  readonly done: Deferred.Deferred<void, E>
  owner?: Fiber.Fiber<void, never>
  pendingWake: boolean
  stopping: boolean
  finalizing: boolean
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
  readonly onStart?: (key: Key) => Effect.Effect<void>
  readonly onSettle?: (key: Key, exit: Exit.Exit<void, E>) => Effect.Effect<void>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()
    const mutations = KeyedMutex.makeUnsafe<Key>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()

    const makeEntry = (): Entry<E> => ({
      done: Deferred.makeUnsafe<void, E>(),
      pendingWake: false,
      stopping: false,
      finalizing: false,
    })

    const start = (key: Key, entry: Entry<E>, force: boolean, successor = false) => {
      const ready = Deferred.makeUnsafe<void>()
      const owner = fork(
        (successor ? Effect.yieldNow : Deferred.await(ready)).pipe(
          Effect.andThen(successor ? Effect.void : (options.onStart?.(key) ?? Effect.void)),
          Effect.andThen(Effect.suspend(() => options.drain(key, force))),
          Effect.onExit((exit) =>
            Effect.sync(() => settle(key, entry, exit)).pipe(
              Effect.flatMap(({ notify }) =>
                notify
                  ? (options.onSettle?.(key, exit) ?? Effect.void).pipe(
                      Effect.ensuring(Effect.sync(() => finalize(key, entry, exit))),
                    )
                  : Effect.void,
              ),
            ),
          ),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      if (Exit.isSuccess(exit) && !entry.stopping && entry.pendingWake) {
        entry.pendingWake = false
        start(key, entry, false, true)
        return { notify: false }
      }

      entry.finalizing = true
      return { notify: true }
    }

    const finalize = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      entry.finalizing = false
      if (entry.pendingWake) {
        entry.pendingWake = false
        const successor = makeEntry()
        active.set(key, successor)
        start(key, successor, false)
        Deferred.doneUnsafe(entry.done, exit)
        return
      }
      if (active.get(key) === entry) active.delete(key)
      Deferred.doneUnsafe(entry.done, exit)
    }

    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping || entry.finalizing) return restore(Deferred.await(entry.done).pipe(Effect.andThen(run(key))))
          return restore(Deferred.await(entry.done))
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, true)
        return restore(Deferred.await(next.done))
      })

    const wake = (key: Key) =>
      Effect.sync(() => {
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.pendingWake = true
          return
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, false)
      })

    const interrupt = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        entry.stopping = true
        entry.pendingWake = false
        return Fiber.interrupt(entry.owner)
      })

    const fence = <A, E2, R>(key: Key, effect: Effect.Effect<A, E2, R>): Effect.Effect<A, E2, R> =>
      Effect.uninterruptibleMask((restore) =>
        interrupt(key).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              const current = active.get(key)
              if (current)
                return Deferred.await(current.done).pipe(Effect.exit, Effect.andThen(fence(key, effect)))

              const entry = makeEntry()
              entry.stopping = true
              active.set(key, entry)
              return restore(effect).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    const pendingWake = entry.pendingWake
                    if (active.get(key) === entry) active.delete(key)
                    Deferred.doneUnsafe(entry.done, Effect.void)
                    if (!pendingWake) return
                    const successor = makeEntry()
                    active.set(key, successor)
                    start(key, successor, false)
                  }),
                ),
              )
            }),
          ),
        ),
      )

    const mutate = <A, E2, R>(key: Key, effect: Effect.Effect<A, E2, R>) => mutations.withLock(key)(effect)
    const serialize = <A, E2, R>(key: Key, effect: Effect.Effect<A, E2, R>) => mutations.withLock(key)(fence(key, effect))

    return { active: Effect.sync(() => new Set(active.keys())), run, wake, interrupt, mutate, serialize }
  })
