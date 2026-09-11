import { SystemContext } from "../system-context/index"

export const tools = new Set(["question", "todowrite", "webfetch", "websearch"])
export const contextEntries = new Set<SystemContext.Key>([SystemContext.Key.make("core/builtins")])
export const context = new Set<SystemContext.Key>([SystemContext.Key.make("core/date")])

export const system = [
  "This is a chat project without an attached workspace.",
  "You may discuss and write code in your response, but you cannot inspect, modify, or execute files or commands.",
  "Do not claim to have changed files. Ask the user to attach a folder before performing workspace tasks.",
].join(" ")

export * as ChatPolicy from "./chat-policy"
