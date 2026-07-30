import { Schema } from "effect"
import { ascending } from "./identifier"
import { statics } from "./schema"

export const ProjectID = Schema.String.pipe(
  Schema.brand("Project.ID"),
  statics((schema) => ({
    global: schema.make("global"),
    create: () => schema.make("prj_" + ascending()),
  })),
)
export type ProjectID = typeof ProjectID.Type
