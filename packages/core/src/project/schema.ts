export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { Project } from "@hena/schema/project"
import { AbsolutePath } from "../schema"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Mode = Project.Mode
export type Mode = Project.Mode

export const AttachOperationID = Project.AttachOperationID
export type AttachOperationID = Project.AttachOperationID

export const AttachPhase = Project.AttachPhase
export type AttachPhase = Project.AttachPhase

export const AttachOperation = Project.AttachOperation
export type AttachOperation = Project.AttachOperation

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type
