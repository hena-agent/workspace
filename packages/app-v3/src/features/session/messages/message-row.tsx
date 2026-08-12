import type { SessionMessage } from "@/lib/types"
import { AssistantMessageRow } from "./assistant-message-row"
import { CompactionMessageRow } from "./compaction-message-row"
import { ShellMessageRow } from "./shell-message-row"
import { SwitchedMessageRow } from "./switched-message-row"
import { SystemMessageRow } from "./system-message-row"
import { UserMessageRow } from "./user-message-row"

/** Dispatches every `SessionMessage` union member to its row renderer. Each
 * kind has a defined rendering (spec §8.2) — no unknown-part fallback needed
 * here since the role union is closed and exhaustively switched. */
export function MessageRow({ message }: { message: SessionMessage }) {
  switch (message.role) {
    case "user":
      return <UserMessageRow message={message} />
    case "assistant":
      return <AssistantMessageRow message={message} />
    case "compaction":
      return <CompactionMessageRow message={message} />
    case "shell":
      return <ShellMessageRow message={message} />
    case "system":
    case "synthetic":
      return <SystemMessageRow message={message} />
    case "agent-switched":
    case "model-switched":
      return <SwitchedMessageRow message={message} />
    default: {
      const exhaustive: never = message
      return exhaustive
    }
  }
}
