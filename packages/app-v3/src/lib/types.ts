export type ConnectionStatus = "online" | "connecting" | "offline"
export type ConnectionHealth =
  | "self"
  | "reachable"
  | "live"
  | "connecting"
  | "reconnecting"
  | "unreachable"
  | "auth-unsupported"
  | "upgrade-required"
  | "error"

export type Connection = {
  name: string
  url: string
  status: ConnectionStatus
  health: ConnectionHealth
  statusMessage?: string
  removable?: boolean
}

export type Project = {
  id: string
  connectionId: string
  name: string
  path: string
  color?: AvatarColor
  updatedAt: number
}

export type ProjectNotification = {
  kind: "none" | "unread" | "permission" | "error"
  working: boolean
}

export type AvatarColor = "pink" | "mint" | "orange" | "purple" | "cyan" | "lime"

export type SessionStatus = "idle" | "working" | "error" | "permission" | "question"

export type Session = {
  id: string
  projectId: string
  connectionId: string
  title: string
  status: SessionStatus
  unread: boolean
  createdAt: number
  updatedAt: number
  archived: boolean
  shared: boolean
  parentId?: string
  agentId?: string
  model?: ModelRef
}

export type ToolStatus = "pending" | "running" | "completed" | "error"

export type TextPart = {
  id: string
  kind: "text"
  text: string
  live?: LiveText
  content?: ContentReference
}

export type ReasoningPart = {
  id: string
  kind: "reasoning"
  text: string
  live?: LiveText
}

export type ToolPart = {
  id: string
  kind: "tool"
  tool: string
  status: ToolStatus
  input: string
  output?: string
  durationMs?: number
  liveInput?: LiveText
  outputContent?: ContentReference
}

export type UnknownPart = {
  id: string
  kind: "unknown"
  type: string
  summary: string
}

export type LiveText = {
  subscribe: (listener: () => void) => () => void
  snapshot: () => string
  incomplete: () => boolean
}

export type ContentPage = { text: string; offset: number; nextOffset: number; totalBytes: number; revision: string }

export type ContentReference = {
  id: string
  revision: string
  bytes: number
  queryKey: readonly unknown[]
  loadPage: (offset: number, signal: AbortSignal) => Promise<ContentPage>
}

export type AssistantPart = TextPart | ReasoningPart | ToolPart | UnknownPart

export type MessageBase = {
  id: string
  sessionId: string
  createdAt: number
  pending?: boolean
}

export type UserMessage = MessageBase & {
  role: "user"
  text: string
  files?: string[]
}

export type AssistantMessage = MessageBase & {
  role: "assistant"
  parts: AssistantPart[]
  agent?: string
  model?: string
}

export type CompactionMessage = MessageBase & {
  role: "compaction"
  summary: string
  final: boolean
}

export type ShellMessage = MessageBase & {
  role: "shell"
  command: string
  output: string
}

export type SystemMessage = MessageBase & {
  role: "system"
  text: string
}

export type SyntheticMessage = MessageBase & {
  role: "synthetic"
  text: string
}

export type AgentSwitchedMessage = MessageBase & {
  role: "agent-switched"
  from: string
  to: string
}

export type ModelSwitchedMessage = MessageBase & {
  role: "model-switched"
  from: string
  to: string
}

export type UnknownMessage = MessageBase & {
  role: "unknown"
  type: string
  summary: string
}

export type SessionMessage =
  | UserMessage
  | AssistantMessage
  | CompactionMessage
  | ShellMessage
  | SystemMessage
  | SyntheticMessage
  | AgentSwitchedMessage
  | ModelSwitchedMessage
  | UnknownMessage

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

export type Todo = {
  id: string
  sessionId: string
  text: string
  status: TodoStatus
}

export type PermissionRequest = {
  id: string
  sessionId: string
  title: string
  description: string
  createdAt: number
}

export type QuestionChoice = {
  id: string
  label: string
}

export type QuestionRequest = {
  id: string
  sessionId: string
  prompt: string
  choices: QuestionChoice[]
  createdAt: number
}

export type DiffKind = "add" | "delete" | "mixed"

export type DiffLine = {
  id: string
  kind: "context" | "add" | "delete"
  text: string
}

export type DiffFile = {
  path: string
  kind: DiffKind
  additions: number
  deletions: number
  lines: DiffLine[]
}

export type FileNode = {
  path: string
  type: "file" | "directory"
  children?: FileNode[]
}

export type Agent = {
  id: string
  name: string
  description: string
}

export type ModelRef = {
  id: string
  providerId: string
}

export type Model = ModelRef & {
  name: string
  contextWindow: number
}

export type Provider = {
  id: string
  name: string
  connected: boolean
}

export type McpServer = {
  id: string
  name: string
  status: "connected" | "disconnected" | "error"
}

export type ServerCommand = {
  id: string
  name: string
  description: string
}
