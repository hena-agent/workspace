export * as SessionActivity from "./activity"

import { Context, Deferred, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"

export interface Interface {
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly register: (sessionID: SessionSchema.ID) => Effect.Effect<Effect.Effect<void>>
  readonly claimInactive: (
    sessionIDs: ReadonlyArray<SessionSchema.ID>,
    allowed?: SessionSchema.ID,
  ) => Effect.Effect<{ readonly release: Effect.Effect<void> }, ReadonlyArray<SessionSchema.ID>>
}

export class Service extends Context.Service<Service, Interface>()("@hena/SessionActivity") {}

const layer = Layer.sync(Service, () => {
  const active = new Map<SessionSchema.ID, number>()
  const blocked = new Map<SessionSchema.ID, Deferred.Deferred<void>>()
  const register = (sessionID: SessionSchema.ID): Effect.Effect<Effect.Effect<void>> =>
    Effect.suspend(() => {
      const gate = blocked.get(sessionID)
      if (gate) return Deferred.await(gate).pipe(Effect.andThen(register(sessionID)))
      active.set(sessionID, (active.get(sessionID) ?? 0) + 1)
      return Effect.succeed(
        Effect.sync(() => {
          const count = active.get(sessionID)
          if (count === undefined) return
          if (count === 1) active.delete(sessionID)
          else active.set(sessionID, count - 1)
        }),
      )
    })

  return Service.of({
    active: Effect.sync(() => new Set(active.keys())),
    register,
    claimInactive: (sessionIDs, allowed) =>
      Effect.suspend(() => {
        const conflicts = sessionIDs.filter((sessionID) => sessionID !== allowed && active.has(sessionID))
        if (conflicts.length > 0) return Effect.fail(conflicts)
        const gates = sessionIDs.map((sessionID) => [sessionID, Deferred.makeUnsafe<void>()] as const)
        gates.forEach(([sessionID, gate]) => blocked.set(sessionID, gate))
        return Effect.succeed({
          release: Effect.sync(() => {
            gates.forEach(([sessionID, gate]) => {
              if (blocked.get(sessionID) === gate) blocked.delete(sessionID)
              Deferred.doneUnsafe(gate, Effect.void)
            })
          }),
        })
      }),
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
