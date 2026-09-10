import { expect, test } from "bun:test"
import { useFilteredList } from "@hena/ui/hooks"
import { createEffect, createRoot } from "solid-js"

test.each(["strings", "objects"])("filtered %s lists retain every match beyond the first ten", async (mode) => {
  const names = [...Array.from({ length: 12 }, (_, index) => `Model ${index}`), "Unrelated tool"]
  const ready = Promise.withResolvers<void>()
  const root = createRoot((dispose) => {
    const list = useFilteredList<string | { name: string }>({
      items: mode === "strings" ? names : names.map((name) => ({ name })),
      key: (item) => (typeof item === "string" ? item : item.name),
      filterKeys: mode === "strings" ? undefined : ["name"],
    })
    createEffect(() => {
      if (list.filter() === "model" && !list.grouped.loading) ready.resolve()
    })
    return { dispose, list }
  })
  try {
    root.list.onInput("model")
    await ready.promise
    expect(root.list.flat()).toHaveLength(12)
    expect(root.list.flat().map((item) => (typeof item === "string" ? item : item.name))).toContain("Model 11")
  } finally {
    root.dispose()
  }
})
