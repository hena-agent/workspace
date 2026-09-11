import { mock } from "bun:test"
import { strict as assert } from "node:assert"
import { createComponent, Suspense } from "solid-js"
import { render } from "solid-js/web"

;(globalThis as typeof globalThis & { React?: unknown }).React = {
  createElement(type: (props: Record<string, unknown>) => unknown, props: Record<string, unknown>, ...children: unknown[]) {
    return type({ ...props, children: children.length === 1 ? children[0] : children })
  },
}

const listCalls: Array<{ location: { directory?: string } }> = []
const catalog = Promise.withResolvers<{ data: { data: [] } }>()

mock.module("@/hooks/use-providers", () => ({
  useProviders: () => ({
    all: () => new Map(),
    connected: () => [],
  }),
}))
mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => () => ({
    scope: "local",
    client: {
      v2: {
        model: {
          list: (input: { location: { directory?: string } }) => {
            listCalls.push(input)
            return catalog.promise
          },
        },
      },
    },
  }),
}))
mock.module("@/utils/persist", () => ({
  Persist: { global: () => "model" },
  persisted: (_target: unknown, store: [unknown, unknown]) => [
    store[0],
    store[1],
    undefined,
    Object.assign(() => true, { promise: Promise.resolve() }),
  ],
}))

const { ModelsProvider, useModels } = await import("@/context/models")

function initialize(managedChat: boolean) {
  const host = document.createElement("div")
  const dispose = render(
    () =>
      createComponent(Suspense, {
        fallback: "loading",
        get children() {
          return createComponent(ModelsProvider, {
            directory: () => "/repo",
            managedChat: () => managedChat,
            children: () => {
              useModels().list()
              return "session"
            },
          })
        },
      }),
    host,
  )
  return { dispose, host }
}

const legacy = initialize(false)
assert.equal(legacy.host.textContent, "session")
legacy.dispose()
assert.deepEqual(listCalls, [])
const managed = initialize(true)
assert.equal(managed.host.textContent, "session")
assert.deepEqual(listCalls, [{ location: { directory: "/repo" } }])
managed.dispose()
