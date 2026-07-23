export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@hena-agent/schema/event"
import { EventManifest } from "@hena-agent/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
