import { describe, expect } from "bun:test"
import { LayerNode } from "@hena/core/effect/layer-node"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))

describe("Auth", () => {
  it.instance("set normalizes trailing slashes in keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeDefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "old",
      })
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "new",
      })
      const data = yield* auth.all()
      const keys = Object.keys(data).filter((key) => key.includes("example.com"))
      expect(keys).toEqual(["https://example.com"])
      const entry = data["https://example.com"]!
      expect(entry.type).toBe("wellknown")
      if (entry.type === "wellknown") expect(entry.token).toBe("new")
    }),
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      yield* auth.remove("https://example.com/")
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeUndefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("anthropic", {
        type: "api",
        key: "sk-test",
      })
      const data = yield* auth.all()
      expect(data["anthropic"]).toBeDefined()
      yield* auth.remove("anthropic")
      const after = yield* auth.all()
      expect(after["anthropic"]).toBeUndefined()
    }),
  )

  it.instance("compare-and-set does not overwrite newer OAuth credentials", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const original = new Auth.Oauth({
        type: "oauth",
        refresh: "refresh-old",
        access: "access-old",
        expires: 1,
      })
      const login = new Auth.Oauth({
        type: "oauth",
        refresh: "refresh-login",
        access: "access-login",
        expires: 2,
      })
      yield* auth.set("openai", original)
      yield* auth.set("openai", login)

      const replaced = yield* auth.compareAndSetOauth(
        "openai",
        original,
        new Auth.Oauth({
          type: "oauth",
          refresh: "refresh-new",
          access: "access-new",
          expires: 3,
        }),
      )

      expect(replaced).toBe(false)
      expect(yield* auth.get("openai")).toEqual(login)
    }),
  )

  it.instance("concurrent provider writes preserve the whole auth file", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* Effect.all(
        [
          auth.set("openai", {
            type: "oauth",
            refresh: "refresh-openai",
            access: "access-openai",
            expires: 1,
          }),
          auth.set("anthropic", {
            type: "api",
            key: "key-anthropic",
          }),
        ],
        { concurrency: "unbounded" },
      )

      const data = yield* auth.all()
      expect(data.openai?.type).toBe("oauth")
      expect(data.anthropic?.type).toBe("api")
    }),
  )
})
