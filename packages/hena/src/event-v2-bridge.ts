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
import { Database } from "@hena/core/database/database"
import { SessionTable } from "@hena/core/session/sql"
import { eq } from "drizzle-orm"
import { SessionV1 } from "@hena/core/v1/session"
import { runtime, runtimeMetadata } from "./session/runtime"

export class Service extends Context.Service<Service, EventV2.Interface>()("@hena/EventV2Bridge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const database = yield* Database.Service

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
        const workspaceID = (yield* WorkspaceRef) ?? event.location?.workspaceID
        const properties = yield* Effect.gen(function* () {
          if (event.type !== SessionV1.Event.Created.type && event.type !== SessionV1.Event.Updated.type) return event.data
          const data = event.data as typeof SessionV1.Event.Updated.Type.data
          const row = yield* database.db
            .select({ runtime })
            .from(SessionTable)
            .where(eq(SessionTable.id, data.sessionID))
            .get()
            .pipe(Effect.orDie)
          if (!row) return data
          return { ...data, info: { ...data.info, metadata: runtimeMetadata(row.runtime, data.info.metadata) } }
        })
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
          payload: { id: event.id, type: event.type, properties },
        })
        if (event.durable === undefined) return
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
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

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2.node, Database.node] })

export * as EventV2Bridge from "./event-v2-bridge"
