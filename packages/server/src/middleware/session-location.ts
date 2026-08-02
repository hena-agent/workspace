import { Database } from "@hena/core/database/database"
import { LocationServiceMap } from "@hena/core/location-services"
import { Location } from "@hena/core/location"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { SessionTable } from "@hena/core/session/sql"
import { WorkspaceV2 } from "@hena/core/workspace"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "@hena/protocol/errors"
import { hasLocationQuery, ref, type LocationServices } from "../location"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@hena/HttpApiSessionLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

const decodeSessionID = Schema.decodeUnknownEffect(SessionV2.ID)

export const sessionLocationLayer = Layer.effect(
  SessionLocationMiddleware,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* LocationServiceMap.Service

    return SessionLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        const sessionID = yield* decodeSessionID(route.params.sessionID).pipe(
          Effect.mapError(
            () =>
              new InvalidRequestError({
                message: "Invalid session ID",
                field: "sessionID",
              }),
          ),
        )
        const row = yield* db
          .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row)
          return yield* new SessionNotFoundError({
            sessionID,
            message: `Session not found: ${sessionID}`,
          })

        const request = yield* HttpServerRequest.HttpServerRequest
        const sessionLocation = Location.Ref.make({
          directory: AbsolutePath.make(row.directory),
          workspaceID: row.workspaceID ? WorkspaceV2.ID.make(row.workspaceID) : undefined,
        })

        return yield* effect.pipe(
          Effect.provide(
            locations.get(hasLocationQuery(request) ? ref(request, sessionLocation) : sessionLocation),
          ),
        )
      }),
    )
  }),
)
