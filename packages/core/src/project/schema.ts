export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { Project } from "@hena/schema/project"
import { AbsolutePath } from "../schema"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Name = Project.Name
export type Name = Project.Name

export const ManagedInfo = Project.ManagedInfo
export type ManagedInfo = Project.ManagedInfo

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type
