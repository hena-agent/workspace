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
import { Agent } from "./agent"
import { Model } from "./model"

export const ProtocolVersion = Schema.Literal(1).annotate({ identifier: "Sync.ProtocolVersion" })
export type ProtocolVersion = typeof ProtocolVersion.Type

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  feedId: Schema.String,
  protocol: Schema.Struct({ min: PositiveInt, max: PositiveInt }),
  auth: Schema.Literals(["none", "required"]),
}).annotate({ identifier: "Sync.Capabilities" })

export interface StreamResource extends Schema.Schema.Type<typeof StreamResource> {}
export const StreamResource = Schema.Struct({
  streamId: Schema.String,
  generation: NonNegativeInt,
  expiresAt: NonNegativeInt,
  feed: Schema.Struct({
    feedId: Schema.String,
    runtimeId: Schema.String,
    retainedFloor: NonNegativeInt,
  }),
  subscriptionRevision: NonNegativeInt,
}).annotate({ identifier: "Sync.StreamResource" })

export interface SubscriptionAccepted extends Schema.Schema.Type<typeof SubscriptionAccepted> {}
export const SubscriptionAccepted = Schema.Struct({
  revision: PositiveInt,
  generation: NonNegativeInt,
}).annotate({ identifier: "Sync.SubscriptionAccepted" })

export interface FrameEnvelope extends Schema.Schema.Type<typeof FrameEnvelope> {}
export const FrameEnvelope = Schema.Struct({
  protocolVersion: ProtocolVersion,
  feedId: Schema.String,
  runtimeId: Schema.String,
  streamId: Schema.String,
  generation: NonNegativeInt,
  subscriptionRevision: PositiveInt,
  type: Schema.String,
}).annotate({ identifier: "Sync.FrameEnvelope" })

export interface Scope extends Schema.Schema.Type<typeof Scope> {}
export const Scope = Schema.Struct({
  collection: Schema.String,
  scopeKey: Schema.String,
}).annotate({ identifier: "Sync.Scope" })

export const RowKey = Schema.Union([Schema.String, Schema.Array(Schema.String)]).annotate({
  identifier: "Sync.RowKey",
})
export type RowKey = typeof RowKey.Type

export interface SnapshotRow extends Schema.Schema.Type<typeof SnapshotRow> {}
export const SnapshotRow = Schema.Struct({
  key: RowKey,
  row: Schema.Record(Schema.String, Schema.Unknown),
  revision: Schema.String.pipe(optional),
}).annotate({ identifier: "Sync.SnapshotRow" })

export interface SnapshotBeginFrame extends Schema.Schema.Type<typeof SnapshotBeginFrame> {}
export const SnapshotBeginFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("snapshot.begin"),
  scope: Scope,
  snapshotId: Schema.String,
  baseSeq: NonNegativeInt,
  replace: Schema.Boolean,
  sourceRevision: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "Sync.SnapshotBeginFrame" })

export interface SnapshotPageFrame extends Schema.Schema.Type<typeof SnapshotPageFrame> {}
export const SnapshotPageFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("snapshot.page"),
  scope: Scope,
  snapshotId: Schema.String,
  rows: Schema.Array(SnapshotRow),
}).annotate({ identifier: "Sync.SnapshotPageFrame" })

export interface SnapshotEndFrame extends Schema.Schema.Type<typeof SnapshotEndFrame> {}
export const SnapshotEndFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("snapshot.end"),
  scope: Scope,
  snapshotId: Schema.String,
  keyCount: NonNegativeInt,
  throughSeq: NonNegativeInt,
}).annotate({ identifier: "Sync.SnapshotEndFrame" })

export interface Change extends Schema.Schema.Type<typeof Change> {}
export const Change = Schema.Struct({
  seq: NonNegativeInt,
  collection: Schema.String,
  scopeKey: Schema.String,
  rowKey: RowKey,
  op: Schema.Literals(["insert", "update", "delete", "reset"]),
  row: Schema.Union([Schema.Record(Schema.String, Schema.Unknown), Schema.Null]),
  rowRevision: Schema.String.pipe(optional),
  txid: Schema.String.pipe(optional),
}).annotate({ identifier: "Sync.Change" })

export interface RowsFrame extends Schema.Schema.Type<typeof RowsFrame> {}
export const RowsFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("rows"),
  affectedScopes: Schema.Array(Scope),
  fromSeq: NonNegativeInt,
  throughSeq: NonNegativeInt,
  changes: Schema.Array(Change),
}).annotate({ identifier: "Sync.RowsFrame" })

export interface DeltaFrame extends Schema.Schema.Type<typeof DeltaFrame> {}
export const DeltaFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("delta"),
  sessionId: Schema.String,
  messageId: Schema.String,
  partId: Schema.String,
  partKind: Schema.Literals(["text", "reasoning", "tool-input", "compaction"]),
  offset: NonNegativeInt,
  text: Schema.String,
}).annotate({ identifier: "Sync.DeltaFrame" })

export interface StreamErrorFrame extends Schema.Schema.Type<typeof StreamErrorFrame> {}
export const StreamErrorFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("error"),
  code: Schema.String,
  scopes: Schema.Array(Schema.Struct({ collection: Schema.String, scopeKey: Schema.String })).pipe(optional),
}).annotate({ identifier: "Sync.StreamErrorFrame" })

export interface HeartbeatFrame extends Schema.Schema.Type<typeof HeartbeatFrame> {}
export const HeartbeatFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("heartbeat"),
  time: NonNegativeInt,
}).annotate({ identifier: "Sync.HeartbeatFrame" })

export interface StreamReadyFrame extends Schema.Schema.Type<typeof StreamReadyFrame> {}
export const StreamReadyFrame = Schema.Struct({
  ...FrameEnvelope.fields,
  type: Schema.Literal("stream.ready"),
}).annotate({ identifier: "Sync.StreamReadyFrame" })

export const StreamFrame = Schema.Union([
  SnapshotBeginFrame,
  SnapshotPageFrame,
  SnapshotEndFrame,
  RowsFrame,
  DeltaFrame,
  StreamErrorFrame,
  HeartbeatFrame,
  StreamReadyFrame,
]).pipe(Schema.toTaggedUnion("type")).annotate({ identifier: "Sync.StreamFrame" })
export type StreamFrame = typeof StreamFrame.Type

export interface ErrorResponse extends Schema.Schema.Type<typeof ErrorResponse> {}
export const ErrorResponse = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    details: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  }),
}).annotate({ identifier: "Sync.ErrorResponse" })

export interface Cursor extends Schema.Schema.Type<typeof Cursor> {}
export const Cursor = Schema.Struct({
  feedId: Schema.String,
  seq: NonNegativeInt,
}).annotate({ identifier: "Sync.Cursor" })

export const MaxSubscribedSessions = 100
export const MaxMarkReadSessions = 100

export interface Subscription extends Schema.Schema.Type<typeof Subscription> {}
export const Subscription = Schema.Struct({
  revision: PositiveInt,
  lists: Schema.Boolean,
  sessions: Schema.Array(Schema.String).check(Schema.isMaxLength(MaxSubscribedSessions)),
  cursors: Schema.Record(Schema.String, Cursor).check(
    Schema.makeFilter((cursors) => Object.keys(cursors).length <= 1_000 || "at most 1000 cursors"),
  ),
}).annotate({ identifier: "Sync.Subscription" })

export const ChangeOperation = Schema.Literals(["insert", "update", "delete", "reset"]).annotate({
  identifier: "Sync.ChangeOperation",
})
export type ChangeOperation = typeof ChangeOperation.Type

const IdempotencyKey = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
)

export interface TransactionReceipt extends Schema.Schema.Type<typeof TransactionReceipt> {}
export const TransactionReceipt = Schema.Struct({
  txid: Schema.String,
  outcome: Schema.Literals(["applied", "noop", "exact_retry"]),
  through: Schema.Struct({ feedId: Schema.String, seq: NonNegativeInt }),
  affectedScopes: Schema.Array(Schema.Struct({ collection: Schema.String, scopeKey: Schema.String })),
}).annotate({ identifier: "Sync.TransactionReceipt" })

export interface SettingReplace extends Schema.Schema.Type<typeof SettingReplace> {}
export const SettingReplace = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  expectedRevision: Schema.String.pipe(optional),
  value: Schema.Json,
}).annotate({ identifier: "Sync.SettingReplace" })

export interface CreateSession extends Schema.Schema.Type<typeof CreateSession> {}
export const CreateSession = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  sessionID: Session.ID.pipe(optional),
  messageID: SessionMessage.ID.pipe(optional),
  location: Location.Ref,
  prompt: PromptInput.Prompt,
  delivery: Schema.Literals(["steer", "queue"]).pipe(optional),
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
}).annotate({ identifier: "Sync.CreateSession" })

export interface AdmitPrompt extends Schema.Schema.Type<typeof AdmitPrompt> {}
export const AdmitPrompt = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  messageID: SessionMessage.ID.pipe(optional),
  prompt: PromptInput.Prompt,
  delivery: Schema.Literals(["steer", "queue"]).pipe(optional),
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
}).annotate({ identifier: "Sync.AdmitPrompt" })

export interface ArchiveSession extends Schema.Schema.Type<typeof ArchiveSession> {}
export const ArchiveSession = Schema.Struct({
  idempotencyKey: IdempotencyKey,
}).annotate({ identifier: "Sync.ArchiveSession" })

export interface MarkSessionsRead extends Schema.Schema.Type<typeof MarkSessionsRead> {}
export const MarkSessionsRead = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  sessionIDs: Schema.Array(Session.ID).check(Schema.isMaxLength(MaxMarkReadSessions)),
}).annotate({ identifier: "Sync.MarkSessionsRead" })

export interface FileListQuery extends Schema.Schema.Type<typeof FileListQuery> {}
export const FileListQuery = Schema.Struct({
  directory: AbsolutePath.check(Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/)),
  workspaceID: Location.Ref.fields.workspaceID,
  path: RelativePath.check(Schema.isPattern(/^(?![\\/]|[A-Za-z]:[\\/])(?!(?:.*[\\/])?\.\.(?:[\\/]|$)).*$/)).pipe(
    optional,
  ),
  limit: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(1_000),
  ).pipe(optional),
}).annotate({ identifier: "Sync.FileListQuery" })

export interface FileFindQuery extends Schema.Schema.Type<typeof FileFindQuery> {}
export const FileFindQuery = Schema.Struct({
  directory: AbsolutePath.check(Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/)),
  workspaceID: Location.Ref.fields.workspaceID,
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(optional),
  limit: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(1_000),
  ).pipe(optional),
}).annotate({ identifier: "Sync.FileFindQuery" })

export interface FileReadQuery extends Schema.Schema.Type<typeof FileReadQuery> {}
export const FileReadQuery = Schema.Struct({
  directory: FileListQuery.fields.directory,
  workspaceID: Location.Ref.fields.workspaceID,
  path: RelativePath.check(Schema.isPattern(/^(?![\\/]|[A-Za-z]:[\\/])(?!(?:.*[\\/])?\.\.(?:[\\/]|$)).+$/)),
  offset: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)).pipe(optional),
  limit: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(256 * 1024),
  ).pipe(optional),
}).annotate({ identifier: "Sync.FileReadQuery" })

export interface CatalogQuery extends Schema.Schema.Type<typeof CatalogQuery> {}
export const CatalogQuery = Schema.Struct({
  directory: FileListQuery.fields.directory,
  workspaceID: Location.Ref.fields.workspaceID,
}).annotate({ identifier: "Sync.CatalogQuery" })

export interface ContentQuery extends Schema.Schema.Type<typeof ContentQuery> {}
export const ContentQuery = Schema.Struct({
  sessionID: Session.ID,
  revision: Schema.String,
  offset: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)).pipe(optional),
  limit: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(256 * 1024),
  ).pipe(optional),
}).annotate({ identifier: "Sync.ContentQuery" })

export interface CancelInput extends Schema.Schema.Type<typeof CancelInput> {}
export const CancelInput = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  expectedRevision: NonNegativeInt,
}).annotate({ identifier: "Sync.CancelInput" })

export interface ReorderInputs extends Schema.Schema.Type<typeof ReorderInputs> {}
export const ReorderInputs = Schema.Struct({
  idempotencyKey: IdempotencyKey,
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
  if (Array.isArray(value))
    return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`
}
