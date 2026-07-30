export * as Project from "./project"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { AbsolutePath, DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema"
import { ProjectID } from "./project-id"

export const ID = ProjectID
export type ID = typeof ID.Type

export const Vcs = Schema.Literal("git").annotate({ identifier: "Project.Vcs" })
export const Icon = Schema.Struct({
  url: optional(Schema.String),
  override: optional(Schema.String),
  color: optional(Schema.String),
}).annotate({ identifier: "Project.Icon" })
export interface Icon extends Schema.Schema.Type<typeof Icon> {}
export const Commands = Schema.Struct({
  start: optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
}).annotate({ identifier: "Project.Commands" })
export interface Commands extends Schema.Schema.Type<typeof Commands> {}
export const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optional(NonNegativeInt),
}).annotate({ identifier: "Project.Time" })
export interface Time extends Schema.Schema.Type<typeof Time> {}

export const Info = Schema.Struct({
  id: ID,
  worktree: Schema.String,
  vcs: optional(Vcs),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Name = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("Project.Name")).annotate({
  identifier: "Project.Name",
})
export type Name = typeof Name.Type

export interface ManagedInfo extends Schema.Schema.Type<typeof ManagedInfo> {}
export const ManagedInfo = Schema.Struct({
  id: ID,
  name: Name,
  worktree: AbsolutePath,
  folder: AbsolutePath.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Project.ManagedInfo" })

export const CreateInput = Schema.Struct({
  name: Name.pipe(optional),
  folder: AbsolutePath.pipe(optional),
}).annotate({ identifier: "Project.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const AttachFolderInput = Schema.Struct({
  projectID: ID,
  folder: AbsolutePath,
}).annotate({ identifier: "Project.AttachFolderInput" })
export type AttachFolderInput = typeof AttachFolderInput.Type

const Updated = define({ type: "project.updated", schema: Info.fields })
export const Event = { Updated, Definitions: inventory(Updated) }
