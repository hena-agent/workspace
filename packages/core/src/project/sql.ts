import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"
import { Timestamps } from "../database/schema.sql"
import { ProjectSchema } from "./schema"

export const ProjectTable = sqliteTable("project", {
  id: text().$type<ProjectSchema.ID>().primaryKey(),
  worktree: DatabasePath.absoluteColumn(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_url_override: text(),
  icon_color: text(),
  ...Timestamps,
  time_initialized: integer(),
  sandboxes: DatabasePath.absoluteArrayColumn().notNull(),
  commands: text({ mode: "json" }).$type<{ start?: string }>(),
})

export const ProjectDirectoryTable = sqliteTable(
  "project_directory",
  {
    project_id: text()
      .$type<ProjectSchema.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: DatabasePath.absoluteColumn().notNull(),
    type: text().$type<"main" | "root" | "git_worktree">(),
    strategy: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.directory] })],
)

export const ProjectAttachmentTable = sqliteTable("project_attachment", {
  source_project_id: text().$type<ProjectSchema.ID>().primaryKey(),
  requested_folder: text().notNull(),
  source_scratch: DatabasePath.absoluteColumn().notNull(),
  attachment: text({ mode: "json" }).$type<ProjectSchema.Attachment>().notNull(),
  relocations: text({ mode: "json" })
    .$type<ReadonlyArray<{ sessionID: string; from: string; to: string; subpath?: string }>>()
    .notNull(),
  checkout: text({ mode: "json" })
    .$type<{ projectID: ProjectSchema.ID; directory: string; vcs?: "git"; head?: string; branch?: string }>()
    .notNull(),
  cleanup_status: text().$type<"pending" | "complete">().notNull(),
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
  time_updated: integer()
    .notNull()
    .$default(() => Date.now()),
})
