import { ProjectAttach } from "@hena/core/project/attach"
import { ProjectNotFoundError, ConflictError, InvalidRequestError, UnknownError } from "@hena/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectAttach.Service

    return handlers.handle(
      "project.attach",
      Effect.fn(function* (ctx) {
        yield* projects.attach({ projectID: ctx.params.projectID, directory: ctx.payload.directory }).pipe(
          Effect.mapError((error) => {
            if (error._tag === "ProjectAttach.NotFoundError")
              return new ProjectNotFoundError({
                projectID: error.projectID,
                message: `Project not found: ${error.projectID}`,
              })
            if (error.reason === "invalid_target")
              return new InvalidRequestError({ message: "Attach target must be outside the managed project" })
            if (error.reason === "target_not_empty")
              return new ConflictError({ message: "Attach target must be empty", resource: ctx.payload.directory })
            if (error.reason === "not_chat")
              return new ConflictError({ message: "Only chat projects can be attached" })
            return new UnknownError({ message: "Failed to move the chat project" })
          }),
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
  }),
)
