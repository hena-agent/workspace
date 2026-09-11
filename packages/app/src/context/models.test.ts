import { describe, expect, test } from "bun:test"
import { modelCatalogKey } from "./models-source"

describe("model catalog source", () => {
  test("is disabled outside managed chat", () => {
    expect(modelCatalogKey({ directory: "/repo", managedChat: false, scope: "server" })).toBeUndefined()
    expect(modelCatalogKey({ managedChat: true, scope: "server" })).toBeUndefined()
  })

  test("keys the managed catalog by server and directory", () => {
    expect(modelCatalogKey({ directory: "/repo", managedChat: true, scope: "server" })).toEqual({
      directory: "/repo",
      scope: "server",
    })
  })
})
