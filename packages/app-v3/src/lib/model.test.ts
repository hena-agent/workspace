import { describe, expect, test } from "bun:test"
import { modelFromWire, modelWire, resolveModel } from "./model"

describe("model references", () => {
  const models = [
    { id: "shared:latest", providerId: "openai" },
    { id: "shared:latest", providerId: "azure" },
    { id: "unique", providerId: "openai" },
  ]

  test("round-trips provider-qualified identities without splitting model IDs", () => {
    const wire = { id: "shared:latest", providerID: "azure" }
    expect(modelFromWire(wire)).toEqual(models[1])
    expect(modelWire(models, modelFromWire(wire))).toEqual(wire)
    expect(resolveModel(models, models[1])).toBe(models[1])
  })

  test("rejects malformed wire references and does not guess another provider", () => {
    for (const value of [undefined, null, [], "unique", { id: "unique" }, { id: 1, providerID: "azure" }]) {
      expect(modelFromWire(value)).toBeUndefined()
    }
    expect(modelWire(models, undefined)).toBeUndefined()
    expect(modelWire(models, { id: "unique", providerId: "azure" })).toBeUndefined()
  })

  test("only resolves legacy IDs when a single catalog entry matches", () => {
    expect(resolveModel(models, "unique")).toBe(models[2])
    expect(resolveModel(models, "shared:latest")).toBeUndefined()
    expect(resolveModel(models, "missing")).toBeUndefined()
    expect(resolveModel([], "unique")).toBeUndefined()
  })
})
