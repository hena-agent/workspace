export * as GeneralChat from "./general-chat"

import { GeneralChat as CoreGeneralChat } from "@hena/core/session/general-chat"
import type { PermissionV1 } from "@hena/core/v1/permission"

export const GENERAL_CHAT_SYSTEM = CoreGeneralChat.GENERAL_CHAT_SYSTEM

export const CEILING: PermissionV1.Ruleset = [
  { permission: "*", pattern: "*", action: "deny" },
  ...CoreGeneralChat.SAFE_ACTIONS.map((permission) => ({ permission, pattern: "*", action: "allow" as const })),
]
