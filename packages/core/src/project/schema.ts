export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { Project } from "@hena/schema/project"
import { AbsolutePath } from "../schema"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Mode = Project.Mode
export type Mode = Project.Mode

export const Info = Project.Info
export type Info = Project.Info

export const Event = Project.Event

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type
