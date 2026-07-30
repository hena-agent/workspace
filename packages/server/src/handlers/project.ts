import { Project } from "@hena/core/project"
import { SessionV2 } from "@hena/core/session"
import { Database } from "@hena/core/database/database"
import {
  ProjectFolderConflictError,
  ProjectFolderInvalidError,
  ProjectNotFoundError,
} from "@hena/protocol/groups/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@hena/protocol/errors"
import { Api } from "../api"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const projects = yield* Project.Service
    const sessions = yield* SessionV2.Service
    const db = (yield* Database.Service).db
    return handlers
      .handle("project.list", () => projects.list())
      .handle("project.create", (ctx) =>
        projects.create(ctx.payload).pipe(
          Effect.catchTag(
            "Project.InvalidNameError",
            () =>
              new InvalidRequestError({
                message: "Project name is required when no folder is selected",
                field: "name",
              }),
          ),
          Effect.mapError((error) => (error instanceof InvalidRequestError ? error : folderError(error))),
        ),
      )
      .handle("project.get", (ctx) => projects.get(ctx.params.projectID).pipe(Effect.mapError(notFound)))
      .handle(
        "project.attachFolder",
        Effect.fn(function* (ctx) {
          return yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                const project = yield* projects.attachFolder(
                  { projectID: ctx.params.projectID, folder: ctx.payload.folder },
                  tx,
                )
                if (!project.folder) return yield* Effect.die("Attached project is missing its folder")
                yield* sessions.rebaseProject({ projectID: project.id, from: project.worktree, to: project.folder }, tx)
                return project
              }),
            )
            .pipe(
              Effect.catchTag("SqlError", Effect.die),
              Effect.mapError((error) =>
                error instanceof Project.NotFoundError ? notFound(error) : folderError(error),
              ),
            )
        }),
      )
  }),
)

function notFound(error: Project.NotFoundError) {
  return new ProjectNotFoundError({
    projectID: error.projectID,
    message: `Project not found: ${error.projectID}`,
  })
}

function folderError(error: Project.InvalidFolderError | Project.FolderConflictError) {
  if (error instanceof Project.InvalidFolderError)
    return new ProjectFolderInvalidError({
      folder: error.folder,
      message: `Project folder must be an existing absolute directory: ${error.folder}`,
    })
  return new ProjectFolderConflictError({
    projectID: error.projectID,
    folder: error.folder,
    message: "This project already has a folder or the folder belongs to another project.",
  })
}
