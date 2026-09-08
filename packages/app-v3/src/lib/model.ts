import type { ModelRef } from "./types"

export function modelFromWire(value: unknown): ModelRef | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  if (!("id" in value) || !("providerID" in value)) return undefined
  if (typeof value.id !== "string" || typeof value.providerID !== "string") return undefined
  return { id: value.id, providerId: value.providerID }
}

export function resolveModel<T extends ModelRef>(models: T[], selection: ModelRef | string | undefined) {
  if (!selection) return undefined
  if (typeof selection !== "string") {
    return models.find((item) => item.id === selection.id && item.providerId === selection.providerId)
  }
  // Legacy drafts lack provider identity. Never guess when more than one provider matches.
  const matches = models.filter((item) => item.id === selection)
  return matches.length === 1 ? matches[0] : undefined
}

export function modelWire(models: ModelRef[], selection: ModelRef | undefined) {
  const model = resolveModel(models, selection)
  return model ? { id: model.id, providerID: model.providerId } : undefined
}
