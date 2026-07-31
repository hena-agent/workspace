import { Project } from "@hena/core/project"
import { ProjectFolderInvalidError, ProjectNotFoundError } from "@hena/protocol/groups/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@hena/protocol/errors"
import { Api } from "../api"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const projects = yield* Project.Service
    return handlers
      .handle("project.list", () => projects.list())
      .handle("project.create", (ctx) =>
        projects.create(ctx.payload).pipe(
          Effect.catchTag(
            "Project.InvalidNameError",
            () => new InvalidRequestError({ message: "Project name is required", field: "name" }),
          ),
        ),
      )
      .handle("project.get", (ctx) => projects.get(ctx.params.projectID).pipe(Effect.mapError(notFound)))
      .handle(
        "project.attachFolder",
        Effect.fn(function* (ctx) {
          const result = yield* projects.attachFolder({
            projectID: ctx.params.projectID,
            folder: ctx.payload.folder,
          }).pipe(
            Effect.catchTags({
              "Project.NotFoundError": notFound,
              "Project.InvalidFolderError": invalidFolder,
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
