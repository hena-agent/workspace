import { type Accessor, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { filter, firstBy, flat, groupBy, mapValues, pipe, uniqueBy, values } from "remeda"
import { createSimpleContext } from "@hena/ui/context"
import { useProviders } from "@/hooks/use-providers"
import { Persist, persisted } from "@/utils/persist"
import { useServerSDK } from "@/context/server-sdk"
import type { Model, ModelV2Info } from "@hena/sdk/v2/client"
import { modelCatalogKey } from "./models-source"

export type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"
type User = ModelKey & { visibility: Visibility; favorite?: boolean }
type Store = {
  user: User[]
  recent: ModelKey[]
  variant?: Record<string, string | undefined>
}

const RECENT_LIMIT = 5

function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

export const { use: useModels, provider: ModelsProvider } = createSimpleContext({
  name: "Models",
  gate: false,
  init: (props: { directory?: Accessor<string | undefined>; managedChat?: Accessor<boolean> } = {}) => {
    const providers = useProviders(props.directory)
    const serverSDK = useServerSDK()
    const catalogKey = createMemo(() => {
      return modelCatalogKey({
        directory: props.directory?.(),
        managedChat: props.managedChat?.() === true,
        scope: serverSDK().scope,
      })
    })
    const [v2Catalog] = createResource(catalogKey, (key) =>
      serverSDK()
        .client.v2.model.list({ location: { directory: key.directory } })
        .then((response) => response.data?.data ?? []),
    )

    const [store, setStore, _, ready] = persisted(
      Persist.global("model", ["model.v1"]),
      createStore<Store>({
        user: [],
        recent: [],
        variant: {},
      }),
    )

    const available = createMemo(() => {
      const directory = props.directory?.()
      if (directory && props.managedChat?.()) {
        if (v2Catalog.error) throw v2Catalog.error
        if (v2Catalog.state === "pending") return []
        const catalog = v2Catalog.latest
        if (!catalog) return []
        return catalog.flatMap((model) => {
          const provider = providers.all().get(model.providerID)
          if (!provider) return []
          const legacy = provider.models[model.id] ?? toLegacyModel(model)
          return [{ ...legacy, name: model.name, variants: toLegacyVariants(model), provider }]
        })
      }
      return providers.connected().flatMap((p) =>
        Object.values(p.models).map((m) => ({
          ...m,
          provider: p,
        })),
      )
    })

    const release = createMemo(
      () =>
        new Map(
          available().map((model) => {
            const parsed = DateTime.fromISO(model.release_date)
            return [modelKey({ providerID: model.provider.id, modelID: model.id }), parsed] as const
          }),
        ),
    )

    const latest = createMemo(() =>
      pipe(
        available(),
        filter(
          (x) =>
            Math.abs(
              (release().get(modelKey({ providerID: x.provider.id, modelID: x.id })) ?? DateTime.invalid("invalid"))
                .diffNow()
                .as("months"),
            ) < 6,
        ),
        groupBy((x) => x.provider.id),
        mapValues((models) =>
          pipe(
            models,
            groupBy((x) => x.family),
            values(),
            (groups) =>
              groups.flatMap((g) => {
                const first = firstBy(g, [(x) => x.release_date, "desc"])
                return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
              }),
          ),
        ),
        values(),
        flat(),
      ),
    )

    const latestSet = createMemo(() => new Set(latest().map((x) => modelKey(x))))

    const visibility = createMemo(() => {
      const map = new Map<string, Visibility>()
      for (const item of store.user) map.set(`${item.providerID}:${item.modelID}`, item.visibility)
      return map
    })

    const list = createMemo(() =>
      available().map((m) => ({
        ...m,
        name: m.name.replace("(latest)", "").trim(),
        latest: m.name.includes("(latest)"),
      })),
    )

    const find = (key: ModelKey) => list().find((m) => m.id === key.modelID && m.provider.id === key.providerID)

    function update(model: ModelKey, state: Visibility) {
      const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
      if (index >= 0) {
        setStore("user", index, (current) => ({ ...current, visibility: state }))
        return
      }
      setStore("user", store.user.length, { ...model, visibility: state })
    }

    const visible = (model: ModelKey) => {
      const key = modelKey(model)
      const state = visibility().get(key)
      if (state === "hide") return false
      if (state === "show") return true
      if (latestSet().has(key)) return true
      const date = release().get(key)
      if (!date?.isValid) return true
      return false
    }

    const setVisibility = (model: ModelKey, state: boolean) => {
      update(model, state ? "show" : "hide")
    }

    const push = (model: ModelKey) => {
      const uniq = uniqueBy([model, ...store.recent], (x) => `${x.providerID}:${x.modelID}`)
      if (uniq.length > RECENT_LIMIT) uniq.pop()
      setStore("recent", uniq)
    }

    const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
    const getVariant = (model: ModelKey) => store.variant?.[variantKey(model)]

    const setVariant = (model: ModelKey, value: string | undefined) => {
      const key = variantKey(model)
      if (!store.variant) {
        setStore("variant", { [key]: value })
        return
      }
      setStore("variant", key, value)
    }

    const [recentModels] = createResource(
      async () => {
        const recent = store.recent
        await ready.promise
        return recent
      },
      (p) => p,
      { initialValue: [] },
    )
    return {
      ready,
      list,
      find,
      visible,
      setVisibility,
      recent: {
        list: () => recentModels()!,
        push,
      },
      variant: {
        get: getVariant,
        set: setVariant,
      },
    }
  },
})

function toLegacyVariants(model: ModelV2Info) {
  return Object.fromEntries(model.variants.map((variant) => [variant.id, variant.body]))
}

function toLegacyModel(model: ModelV2Info): Model {
  const cost = model.cost[0]
  return {
    id: model.id,
    providerID: model.providerID,
    api: {
      id: model.api.id,
      url: model.api.url ?? "",
      npm: model.api.type === "aisdk" ? model.api.package : "",
    },
    name: model.name,
    family: model.family,
    capabilities: {
      temperature: false,
      reasoning: model.capabilities.reasoning === true,
      attachment: model.capabilities.input.some((value) => value !== "text"),
      toolcall: model.capabilities.tools,
      input: {
        text: model.capabilities.input.some((value) => value.startsWith("text")),
        audio: model.capabilities.input.some((value) => value.startsWith("audio")),
        image: model.capabilities.input.some((value) => value.startsWith("image")),
        video: model.capabilities.input.some((value) => value.startsWith("video")),
        pdf: model.capabilities.input.some((value) => value.startsWith("pdf")),
      },
      output: {
        text: model.capabilities.output.some((value) => value.startsWith("text")),
        audio: model.capabilities.output.some((value) => value.startsWith("audio")),
        image: model.capabilities.output.some((value) => value.startsWith("image")),
        video: model.capabilities.output.some((value) => value.startsWith("video")),
        pdf: model.capabilities.output.some((value) => value.startsWith("pdf")),
      },
      interleaved: false,
    },
    cost: {
      input: cost?.input ?? 0,
      output: cost?.output ?? 0,
      cache: {
        read: cost?.cache.read ?? 0,
        write: cost?.cache.write ?? 0,
      },
    },
    limit: model.limit,
    status: model.status,
    options: model.request.body,
    headers: model.request.headers,
    release_date: new Date(model.time.released).toISOString(),
    variants: toLegacyVariants(model),
  }
}
