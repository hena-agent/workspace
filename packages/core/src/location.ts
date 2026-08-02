import { Effect, Layer } from "effect"
import { Info, Ref, response } from "@hena/schema/location"
import { Project } from "./project"
import { LayerNode } from "./effect/layer-node"
import { makeLocationNode, tags } from "./effect/app-node"
import { LocationService } from "./location/service"

export * as Location from "./location"

export { Info, Ref, response }
export { Service } from "./location/service"

export type Interface = LocationService.Interface

export const node = LayerNode.unbound(LocationService.Service, tags.values.location)

const layer = (ref: Ref) =>
  Layer.effect(
    LocationService.Service,
    Effect.gen(function* () {
      const project = yield* Project.Service
      const resolved = yield* project.resolve(ref.directory)
      return LocationService.Service.of({
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        project: { id: resolved.id, directory: resolved.directory },
        vcs: resolved.vcs,
      })
    }),
  )

export const boundNode = (ref: Ref) =>
  makeLocationNode({
    service: LocationService.Service,
    layer: layer(ref),
    deps: [Project.node],
  })
