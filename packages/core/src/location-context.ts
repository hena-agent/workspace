export * as LocationContext from "./location-context"

import { Context } from "effect"
import { Info } from "@hena/schema/location"
import { ProjectSchema } from "./project/schema"

export interface Interface extends Info {
  readonly vcs?: ProjectSchema.Vcs
}

export class Service extends Context.Service<Service, Interface>()("@hena/Location") {}
