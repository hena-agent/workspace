import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"
import { Timestamps } from "../database/schema.sql"
import { ProjectSchema } from "./schema"
import type { EventV2 } from "../event"
import type { SessionSchema } from "../session/schema"
import type { WorkspaceV2 } from "../workspace"

export const ProjectTable = sqliteTable("project", {
  id: text().$type<ProjectSchema.ID>().primaryKey(),
  worktree: DatabasePath.absoluteColumn().notNull(),
  mode: text().$type<ProjectSchema.Mode>().notNull().default("workspace"),
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

export const ProjectAttachOperationTable = sqliteTable(
  "project_attach_operation",
  {
    id: text().$type<ProjectSchema.AttachOperationID>().primaryKey(),
    project_id: text().$type<ProjectSchema.ID>().notNull(),
    source: DatabasePath.absoluteColumn().notNull(),
    target: DatabasePath.absoluteColumn().notNull(),
    staging: DatabasePath.absoluteColumn().notNull(),
    target_existed: integer({ mode: "boolean" }).notNull(),
    phase: text().$type<ProjectSchema.AttachPhase>().notNull(),
    error: text(),
    ...Timestamps,
  },
  (table) => [index("project_attach_operation_project_updated_idx").on(table.project_id, table.time_updated)],
)

export const ProjectAttachSessionTable = sqliteTable(
  "project_attach_session",
  {
    operation_id: text()
      .$type<ProjectSchema.AttachOperationID>()
      .notNull()
      .references(() => ProjectAttachOperationTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    directory: DatabasePath.absoluteColumn().notNull(),
    path: text(),
    workspace_id: text().$type<WorkspaceV2.ID>(),
    forward_event_id: text().$type<EventV2.ID>().notNull(),
    rollback_event_id: text().$type<EventV2.ID>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.operation_id, table.session_id] })],
)

export const ProjectAttachDirectoryTable = sqliteTable(
  "project_attach_directory",
  {
    operation_id: text()
      .$type<ProjectSchema.AttachOperationID>()
      .notNull()
      .references(() => ProjectAttachOperationTable.id, { onDelete: "cascade" }),
    directory: DatabasePath.absoluteColumn().notNull(),
    type: text().$type<"main" | "root" | "git_worktree">(),
    strategy: text(),
    time_created: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.operation_id, table.directory] })],
)
