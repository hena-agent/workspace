import { expect, test } from "bun:test"
import { SessionV2 } from "@hena/core/session"
import { Effect, FileSystem, Layer, Path } from "effect"
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { SessionHandler } from "../src/handlers/session"
import { makeSessionGroup } from "@hena/protocol/groups/session"
import { Authorization } from "@hena/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@hena/protocol/middleware/schema-error"
import { SessionLocationMiddleware } from "../src/middleware/session-location"

test("session.active returns only foreground drains", async () => {
  const active = new Set([SessionV2.ID.make("ses_running")])
  const server = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(HttpApi.make("server").add(makeSessionGroup(SessionLocationMiddleware))).pipe(
      Layer.provide(
        SessionHandler.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                Authorization,
                Authorization.of((effect) => effect),
              ),
              Layer.succeed(
                SchemaErrorMiddleware,
                SchemaErrorMiddleware.of((effect) => effect),
              ),
              Layer.succeed(
                SessionLocationMiddleware,
                SessionLocationMiddleware.of(() => Effect.die("unused")),
              ),
            ),
          ),
        ),
      ),
      Layer.provide(
        Layer.mock(SessionV2.Service, {
          active: Effect.sync(() => new Set(active)),
          revert: {} as SessionV2.Interface["revert"],
        }),
      ),
      Layer.provide(HttpPlatform.layer),
      Layer.provide(Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, Etag.layerWeak)),
    ),
    { disableLogger: true },
  )
  try {
    const response = await server.handler(new Request("http://localhost/api/session/active"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ses_running: { type: "running" } } })
    active.clear()
    expect(await (await server.handler(new Request("http://localhost/api/session/active"))).json()).toEqual({
      data: {},
    })
  } finally {
    await server.dispose()
  }
})
