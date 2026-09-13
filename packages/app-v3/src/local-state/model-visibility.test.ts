import { afterEach, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"
import { encodeServerSlug } from "@/lib/server-url"
import { createConnectionRegistry } from "@/connection/registry"
import { useModelVisibility } from "./model-visibility"

afterEach(() => localStorage.clear())

test("visibility persists across mounts, follows the server, and distinguishes provider/model pairs", () => {
  const first = { providerId: "openai", id: "shared" }
  const second = { providerId: "openrouter", id: "shared" }
  const url = "https://models.example"
  const one = renderHook(() => useModelVisibility(url))
  const two = renderHook(() => useModelVisibility(url))
  expect(one.result.current.visible(first)).toBe(true)
  act(() => one.result.current.setVisibility([first], false))
  expect(two.result.current.visible(first)).toBe(false)
  expect(two.result.current.visible(second)).toBe(true)
  one.unmount()
  two.unmount()

  const restored = renderHook(({ url }) => useModelVisibility(url), { initialProps: { url } })
  expect(restored.result.current.visible(first)).toBe(false)
  restored.rerender({ url: "https://other.example" })
  expect(restored.result.current.visible(first)).toBe(true)
  restored.rerender({ url })
  expect(restored.result.current.visible(first)).toBe(false)
  act(() => restored.result.current.setVisibility([first], true))
  expect(restored.result.current.visible(first)).toBe(true)
})

test("invalid preferences default to visible and storage changes are observed", () => {
  const url = "https://models.example"
  const key = `hena.model-visibility.v1.${encodeServerSlug(url)}`
  const model = { providerId: "openai", id: "gpt-5.2" }
  localStorage.setItem(key, "broken json")
  const view = renderHook(() => useModelVisibility(url))
  expect(view.result.current.visible(model)).toBe(true)
  act(() => view.result.current.setVisibility([model], false))
  expect(view.result.current.visible(model)).toBe(false)
  act(() => {
    localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }))
  })
  expect(view.result.current.visible(model)).toBe(true)
  act(() => {
    localStorage.setItem(key, '{"hidden": false}')
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }))
  })
  expect(view.result.current.visible(model)).toBe(true)
})

test("removing and re-adding a server clears its model visibility preferences", () => {
  const url = "https://models.example"
  const model = { providerId: "openai", id: "gpt-5.2" }
  const registry = createConnectionRegistry()
  registry.add(url)
  const view = renderHook(() => useModelVisibility(url))
  act(() => view.result.current.setVisibility([model], false))
  view.unmount()
  registry.remove(url)
  registry.add(url)
  const restored = renderHook(() => useModelVisibility(url))
  expect(restored.result.current.visible(model)).toBe(true)
})
