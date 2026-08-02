import { Project } from "@hena/core/project"
import {
  ProjectAttachmentConflictError,
  ProjectFolderInvalidError,
  ProjectNotFoundError,
  ProjectSessionsActiveError,
} from "@hena/protocol/groups/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@hena/protocol/errors"
import { Api } from "../api"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const projects = yield* Project.Service
    return handlers
      .handle("project.list", () => projects.list())
      .handle("project.listAttachments", () => projects.listAttachments())
      .handle("project.create", (ctx) =>
        projects
          .create(ctx.payload)
          .pipe(
            Effect.catchTag(
              "Project.InvalidNameError",
              () => new InvalidRequestError({ message: "Project name is required", field: "name" }),
            ),
          ),
      )
      .handle(
        "project.attachFolder",
        Effect.fn(function* (ctx) {
          const result = yield* projects
            .attachFolder({
              projectID: ctx.params.projectID,
              folder: ctx.payload.folder,
              initiatingSessionID: ctx.payload.initiatingSessionID,
            })
            .pipe(
              Effect.catchTags({
                "Project.NotFoundError": notFound,
                "Project.InvalidFolderError": invalidFolder,
                "Project.AttachmentConflictError": attachmentConflict,
                "Project.SessionsActiveError": sessionsActive,
              }),
            )
          return result
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

function invalidFolder(error: Project.InvalidFolderError) {
  return new ProjectFolderInvalidError({
    folder: error.folder,
    message: `Project folder must be an existing absolute directory: ${error.folder}`,
  })
}

function attachmentConflict(error: Project.AttachmentConflictError) {
  return new ProjectAttachmentConflictError({
    projectID: error.projectID,
    message: `Project was already attached to a different folder: ${error.projectID}`,
  })
}

function sessionsActive(error: Project.SessionsActiveError) {
  return new ProjectSessionsActiveError({
    projectID: error.projectID,
    sessionIDs: error.sessionIDs,
    message: "Project cannot be attached while affected sessions are executing",
  })
}
