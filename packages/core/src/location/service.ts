export * as LocationService from "./service"

import { Info } from "@hena/schema/location"
import { Context } from "effect"
import { AbsolutePath } from "../schema"

export interface Interface extends Info {
  readonly vcs?: { readonly type: "git"; readonly store: AbsolutePath }
}

export class Service extends Context.Service<Service, Interface>()("@hena/Location") {}
