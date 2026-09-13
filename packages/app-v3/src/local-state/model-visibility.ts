import { useSyncExternalStore } from "react"
import { Option, Schema } from "effect"
import { modelKey } from "@/lib/model"
import { encodeServerSlug } from "@/lib/server-url"
import type { ModelRef } from "@/lib/types"

const listeners = new Set<() => void>()
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))

export function useModelVisibility(url: string | undefined) {
  const key = url ? `hena.model-visibility.v1.${encodeServerSlug(url)}` : undefined
  const snapshot = useSyncExternalStore(subscribe, () => (key ? localStorage.getItem(key) : null), () => null)
  const hidden = readHidden(snapshot)

  return {
    visible: (model: ModelRef) => !hidden.has(modelKey(model)),
    setVisibility(models: ModelRef[], visible: boolean) {
      if (!key) return
      const next = readHidden(localStorage.getItem(key))
      models.forEach((model) => {
        if (visible) return next.delete(modelKey(model))
        next.add(modelKey(model))
      })
      localStorage.setItem(key, JSON.stringify([...next]))
      listeners.forEach((listener) => listener())
    },
  }
}

function readHidden(value: string | null) {
  return new Set(Option.getOrElse(decode(value ?? "[]"), () => []))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}
