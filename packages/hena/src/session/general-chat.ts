export * as GeneralChat from "./general-chat"

import { GeneralChat as CoreGeneralChat } from "@hena/core/session/general-chat"
import type { PermissionV1 } from "@hena/core/v1/permission"

export const GENERAL_CHAT_SYSTEM = CoreGeneralChat.GENERAL_CHAT_SYSTEM

const ceiling: PermissionV1.Ruleset = [
  { permission: "*", pattern: "*", action: "deny" },
  { permission: "attach_folder", pattern: "*", action: "allow" },
  { permission: "question", pattern: "*", action: "allow" },
  { permission: "webfetch", pattern: "*", action: "allow" },
  { permission: "websearch", pattern: "*", action: "allow" },
]

export function system(active: boolean, coding: ReadonlyArray<string>) {
  return CoreGeneralChat.system(active, coding)
}

export function permissions(active: boolean, configured: PermissionV1.Ruleset = []) {
  return active ? [...configured, ...ceiling] : configured
}
