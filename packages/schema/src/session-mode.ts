export * as SessionMode from "./session-mode"

import { Schema } from "effect"

export const Mode = Schema.Literal("general-chat").annotate({ identifier: "Session.Mode" })
export type Mode = typeof Mode.Type
