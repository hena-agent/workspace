export * as GeneralChat from "./general-chat"

import type { PermissionV2 } from "../permission"
import GENERAL_CHAT_SYSTEM from "./prompt/general-chat.txt"

export { GENERAL_CHAT_SYSTEM }

export const SAFE_ACTIONS = ["question", "webfetch", "websearch"] as const

export const CEILING: PermissionV2.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  ...SAFE_ACTIONS.map((action) => ({ action, resource: "*", effect: "allow" as const })),
]
