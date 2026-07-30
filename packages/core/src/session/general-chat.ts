export * as GeneralChat from "./general-chat"

import type { PermissionV2 } from "../permission"
import GENERAL_CHAT_SYSTEM from "./prompt/general-chat.txt"

export { GENERAL_CHAT_SYSTEM }

const ceiling: PermissionV2.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "question", resource: "*", effect: "allow" },
  { action: "webfetch", resource: "*", effect: "allow" },
  { action: "websearch", resource: "*", effect: "allow" },
]

export function system(active: boolean, coding: ReadonlyArray<string>) {
  return active ? [GENERAL_CHAT_SYSTEM] : [...coding]
}

export function permissions(active: boolean, configured: PermissionV2.Ruleset = []) {
  return active ? [...configured, ...ceiling] : configured
}
