import { Auth } from "@/auth"

import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@hena/core/provider"
import { OPENAI_OAUTH_REFRESH_WINDOW_MS, refreshOpenAIAuth } from "@/plugin/openai/codex"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authRefresh = Effect.fn("ControlHttpApi.authRefresh")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      if (ctx.params.providerID !== "openai") return yield* new HttpApiError.BadRequest({})

      const refreshed = yield* Effect.tryPromise({
        try: (signal) =>
          refreshOpenAIAuth({
            getAuth: async () => {
              const current = await Effect.runPromise(auth.get("openai"))
              if (current?.type !== "oauth") throw new Error("OpenAI OAuth authentication is unavailable")
              return current
            },
            setAuth: (expected, next) =>
              Effect.runPromise(auth.compareAndSetOauth("openai", new Auth.Oauth(expected), new Auth.Oauth(next))),
            minimumValidityMs: OPENAI_OAUTH_REFRESH_WINDOW_MS,
            signal,
          }),
        catch: () => new HttpApiError.BadRequest({}),
      })
      return {
        type: "oauth" as const,
        access: refreshed.access,
        expires: refreshed.expires,
        ...(refreshed.accountId ? { accountId: refreshed.accountId } : {}),
        fedramp: refreshed.fedramp,
      }
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    return handlers
      .handle("authSet", authSet)
      .handle("authRefresh", authRefresh)
      .handle("authRemove", authRemove)
      .handle("log", log)
  }),
)
