// Hena publish boundary for core events. Attach routed instance location
// so direct EventV2 consumers can isolate directory/workspace streams.
import { LayerNode } from "@hena/core/effect/layer-node"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@hena/core/event"
import { Location } from "@hena/core/location"
import { Project } from "@hena/core/project"
import { AbsolutePath } from "@hena/core/schema"
import { Context, Effect, Layer } from "effect"

export class Service extends Context.Service<Service, EventV2.Interface>()("@hena/EventV2Bridge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    const publish: EventV2.Interface["publish"] = (definition, data, options) =>
      Effect.gen(function* () {
        if (options?.location) return yield* events.publish(definition, data, options)
        const ctx = yield* InstanceRef
        if (!ctx) return yield* events.publish(definition, data, options)
        const workspaceID = yield* WorkspaceRef
        return yield* events.publish(definition, data, {
          ...options,
          location: new Location.Info({
            directory: AbsolutePath.make(ctx.directory),
            ...(workspaceID ? { workspaceID } : {}),
            project: { id: Project.ID.make(ctx.project.id), directory: AbsolutePath.make(ctx.worktree) },
          }),
        })
      })

    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceRef
        const workspaceID = event.location?.workspaceID ?? (yield* WorkspaceRef)
        const project = event.location instanceof Location.Info ? event.location.project.id : ctx?.project.id
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project,
          workspace: workspaceID,
          payload: { id: event.id, type: event.type, properties: event.data },
        })
        if (event.durable === undefined) return
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project,
          workspace: workspaceID,
          payload: {
            type: "sync",
            syncEvent: {
              id: event.id,
              type: EventV2.versionedType(event.type, event.durable.version),
              seq: event.durable.seq,
              aggregateID: event.durable.aggregateID,
              data: event.data,
            },
          },
        })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({ ...events, publish })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2.node] })

export * as EventV2Bridge from "./event-v2-bridge"
