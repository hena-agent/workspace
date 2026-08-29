import { Effect } from "effect"
import { ProviderV2 } from "../../provider"
import { define } from "../internal"

export const OpenCodePlugin = define({
  id: "opencode",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      const providerID = ProviderV2.ID.make("opencode")
      if (!catalog.provider.get(providerID)) return
      catalog.provider.update(providerID, (provider) => {
        provider.request.body.apiKey ??= ProviderV2.PUBLIC_API_KEY
      })
    })
  }),
})
