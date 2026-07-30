export * as SessionMode from "./mode"

import { Session } from "@hena/schema/session"
import GENERAL_CHAT_SYSTEM from "./prompt/general-chat.txt"

export const Mode = Session.Mode
export type Mode = Session.Mode

export { GENERAL_CHAT_SYSTEM }

const GENERAL_CHAT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "attach_folder",
  "question",
  "webfetch",
  "websearch",
])

export function system(mode: Mode | undefined, coding: ReadonlyArray<string>) {
  return mode === "general-chat" ? [GENERAL_CHAT_SYSTEM] : [...coding]
}

export function toolNames(mode: Mode | undefined) {
  return mode === "general-chat" ? GENERAL_CHAT_TOOL_NAMES : undefined
}
