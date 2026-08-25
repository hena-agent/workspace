import type { Sync } from "@hena/schema/sync"
import type { Agent } from "@hena/schema/agent"
import type { Model } from "@hena/schema/model"
import type { Provider } from "@hena/schema/provider"

export type SessionRecord = { id: string } & Record<string, unknown>
export type InputRecord = { id: string; sessionID: string } & Record<string, unknown>
export type OnlineReply = {
  outcome: "applied" | "already_resolved"
  resolution: Record<string, unknown>
}
export type Receipt = Sync.TransactionReceipt

export interface CoreDomain {
  ready(): Promise<void>
  createSession(input: Sync.CreateSession): Promise<{ session: SessionRecord; admitted: InputRecord; receipt: Receipt }>
  admitPrompt(sessionID: string, input: Sync.AdmitPrompt): Promise<{ admitted: InputRecord; receipt: Receipt }>
  interrupt(sessionID: string): Promise<void>
  cancelInput(sessionID: string, messageID: string, input: Sync.CancelInput): Promise<{ revision: number; receipt: Receipt }>
  reorderInputs(sessionID: string, input: Sync.ReorderInputs): Promise<{ revision: number; receipt: Receipt }>
  listFiles(input: Sync.FileListQuery): Promise<readonly { path: string; type: "file" | "directory" }[]>
  findFiles(input: Sync.FileFindQuery): Promise<readonly { path: string; type: "file" | "directory" }[]>
  readFile(input: Sync.FileReadQuery): Promise<
    | { text: string; totalBytes: number; truncated: boolean }
    | { binary: true; totalBytes: number }
  >
  replyPermission(requestID: string, input: Sync.PermissionReply): Promise<OnlineReply>
  replyQuestion(requestID: string, input: Sync.QuestionReply): Promise<OnlineReply>
  catalog(location: { directory: string; workspaceID?: string }): Promise<{
    agents: readonly Agent.Info[]
    models: readonly Model.Info[]
    providers: readonly Provider.Info[]
  }>
  dispose(): Promise<void>
}

export function unavailableCoreDomain(): CoreDomain {
  const unavailable = () => Promise.reject(new Error("Core domain is unavailable"))
  return {
    ready: () => Promise.resolve(),
    createSession: unavailable,
    admitPrompt: unavailable,
    interrupt: unavailable,
    cancelInput: unavailable,
    reorderInputs: unavailable,
    listFiles: unavailable,
    findFiles: unavailable,
    readFile: unavailable,
    replyPermission: unavailable,
    replyQuestion: unavailable,
    catalog: unavailable,
    dispose: () => Promise.resolve(),
  }
}
