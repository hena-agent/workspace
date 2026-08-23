export * as Sync from "./sync"

import { Schema } from "effect"
import { AbsolutePath, NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { optional } from "./schema"
import { Location } from "./location"
import { PromptInput } from "./prompt-input"
import { Session } from "./session"
import { SessionMessage } from "./session-message"
import { Permission } from "./permission"
import { Question } from "./question"

export const ProtocolVersion = Schema.Literal(1).annotate({ identifier: "Sync.ProtocolVersion" })
export type ProtocolVersion = typeof ProtocolVersion.Type

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  feedId: Schema.String,
  protocol: Schema.Struct({ min: ProtocolVersion, max: ProtocolVersion }),
  auth: Schema.Literals(["none", "required"]),
}).annotate({ identifier: "Sync.Capabilities" })

export interface Cursor extends Schema.Schema.Type<typeof Cursor> {}
export const Cursor = Schema.Struct({
  feedId: Schema.String,
  seq: NonNegativeInt,
}).annotate({ identifier: "Sync.Cursor" })

export interface Subscription extends Schema.Schema.Type<typeof Subscription> {}
export const Subscription = Schema.Struct({
  revision: PositiveInt,
  lists: Schema.Boolean,
  sessions: Schema.Array(Schema.String),
  cursors: Schema.Record(Schema.String, Cursor),
}).annotate({ identifier: "Sync.Subscription" })

export const ChangeOperation = Schema.Literals(["insert", "update", "delete", "reset"]).annotate({
  identifier: "Sync.ChangeOperation",
})
export type ChangeOperation = typeof ChangeOperation.Type

export interface TransactionReceipt extends Schema.Schema.Type<typeof TransactionReceipt> {}
export const TransactionReceipt = Schema.Struct({
  txid: Schema.String,
  outcome: Schema.Literals(["applied", "noop", "exact_retry"]),
  through: Schema.Struct({ feedId: Schema.String, seq: NonNegativeInt }),
  affectedScopes: Schema.Array(Schema.Struct({ collection: Schema.String, scopeKey: Schema.String })),
}).annotate({ identifier: "Sync.TransactionReceipt" })

export interface SettingReplace extends Schema.Schema.Type<typeof SettingReplace> {}
export const SettingReplace = Schema.Struct({
  idempotencyKey: Schema.String,
  expectedRevision: Schema.String.pipe(optional),
  value: Schema.Json,
}).annotate({ identifier: "Sync.SettingReplace" })

export interface CreateSession extends Schema.Schema.Type<typeof CreateSession> {}
export const CreateSession = Schema.Struct({
  idempotencyKey: Schema.String,
  sessionID: Session.ID.pipe(optional),
  messageID: SessionMessage.ID.pipe(optional),
  location: Location.Ref,
  prompt: PromptInput.Prompt,
  delivery: Schema.Literals(["steer", "queue"]).pipe(optional),
}).annotate({ identifier: "Sync.CreateSession" })

export interface AdmitPrompt extends Schema.Schema.Type<typeof AdmitPrompt> {}
export const AdmitPrompt = Schema.Struct({
  idempotencyKey: Schema.String,
  messageID: SessionMessage.ID.pipe(optional),
  prompt: PromptInput.Prompt,
  delivery: Schema.Literals(["steer", "queue"]).pipe(optional),
}).annotate({ identifier: "Sync.AdmitPrompt" })

export interface FileListQuery extends Schema.Schema.Type<typeof FileListQuery> {}
export const FileListQuery = Schema.Struct({
  directory: AbsolutePath.check(Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/)),
  workspaceID: Schema.String.pipe(optional),
  path: RelativePath.check(
    Schema.isPattern(/^(?![\\/]|[A-Za-z]:[\\/])(?!(?:.*[\\/])?\.\.(?:[\\/]|$)).*$/),
  ).pipe(optional),
}).annotate({ identifier: "Sync.FileListQuery" })

export interface FileFindQuery extends Schema.Schema.Type<typeof FileFindQuery> {}
export const FileFindQuery = Schema.Struct({
  directory: AbsolutePath.check(Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/)),
  workspaceID: Schema.String.pipe(optional),
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(optional),
  limit: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(1_000),
  ).pipe(optional),
}).annotate({ identifier: "Sync.FileFindQuery" })

export interface CancelInput extends Schema.Schema.Type<typeof CancelInput> {}
export const CancelInput = Schema.Struct({
  idempotencyKey: Schema.String,
  expectedRevision: NonNegativeInt,
}).annotate({ identifier: "Sync.CancelInput" })

export interface ReorderInputs extends Schema.Schema.Type<typeof ReorderInputs> {}
export const ReorderInputs = Schema.Struct({
  idempotencyKey: Schema.String,
  expectedRevision: NonNegativeInt,
  messageIDs: Schema.Array(SessionMessage.ID),
}).annotate({ identifier: "Sync.ReorderInputs" })

export interface PermissionReply extends Schema.Schema.Type<typeof PermissionReply> {}
export const PermissionReply = Schema.Struct({
  location: Location.Ref,
  sessionID: Session.ID,
  nonce: Schema.String,
  reply: Permission.Reply,
  message: Schema.String.pipe(optional),
}).annotate({ identifier: "Sync.PermissionReply" })

export interface QuestionReply extends Schema.Schema.Type<typeof QuestionReply> {}
export const QuestionReply = Schema.Struct({
  location: Location.Ref,
  sessionID: Session.ID,
  nonce: Schema.String,
  answers: Question.Reply.fields.answers,
}).annotate({ identifier: "Sync.QuestionReply" })

export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new TypeError("Cannot canonicalize undefined")
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => entry === undefined ? "null" : canonicalJson(entry)).join(",")}]`
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`
}
