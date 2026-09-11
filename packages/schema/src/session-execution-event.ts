export * as SessionExecutionEvent from "./session-execution-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionMessage } from "./session-message"
import { SessionID } from "./session-id"
import { DateTimeUtcFromMillis } from "./schema"

const UnknownError = SessionMessage.UnknownError

export const Status = Event.define({
  type: "session.next.execution.status",
  schema: {
    timestamp: DateTimeUtcFromMillis,
    sessionID: SessionID,
    status: Schema.Union([
      Schema.Struct({ type: Schema.Literal("running") }),
      Schema.Struct({ type: Schema.Literal("idle") }),
      Schema.Struct({ type: Schema.Literal("failed"), error: UnknownError }),
    ]),
  },
})

export const Definitions = Event.inventory(Status)
export type Status = typeof Status.Type
