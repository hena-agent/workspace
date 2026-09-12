export * as SessionExecution from "./execution"

import { Context, Effect, Layer, Option } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Node } from "../effect/app-node"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"

export type Status =
  | { readonly type: "running" }
  | { readonly type: "idle" }
  | { readonly type: "failed"; readonly error: { readonly type: "unknown"; readonly message: string } }

export interface Interface {
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly mutate: <A, E, R>(sessionID: SessionSchema.ID, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly serialize: <A, E, R>(
    sessionID: SessionSchema.ID,
    effect: Effect.Effect<A, E, R>,
    reconcile?: Effect.Effect<Option.Option<A>, E, R>,
  ) => Effect.Effect<A, E, R>
}

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@hena/v2/SessionExecution") {}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    mutate: (_sessionID, effect) => effect,
    serialize: (_sessionID, effect, reconcile) =>
      reconcile
        ? reconcile.pipe(Effect.flatMap((result) => (Option.isSome(result) ? Effect.succeed(result.value) : effect)))
        : effect,
  }),
)
