import { expect, test } from "bun:test"
import { createHenaClient } from "../src/client"
import { createClient } from "../src/gen/client/client.gen"

test("auth refresh uses the configured client transport", async () => {
  const client = createHenaClient({
    baseUrl: "https://hena.test",
    async fetch(request) {
      expect(request.method).toBe("POST")
      expect(new URL(request.url).pathname).toBe("/auth/openai/refresh")
      expect(request.headers.get("authorization")).toBe("Basic test")
      return Response.json({
        type: "oauth",
        access: "access-token",
        expires: 1_800_000,
        fedramp: false,
      })
    },
    headers: { authorization: "Basic test" },
  })

  const response = await client.auth.refresh({
    path: { providerID: "openai" },
    throwOnError: true,
  })

  expect(response.data.access).toBe("access-token")
})

test("auth refresh honors a per-call client override", async () => {
  const client = createHenaClient({
    baseUrl: "https://default.test",
    fetch() {
      throw new Error("default transport should not be called")
    },
  })
  const response = await client.auth.refresh({
    path: { providerID: "openai" },
    client: createClient({
      baseUrl: "https://override.test",
      fetch(request) {
        expect(new URL(request.url).origin).toBe("https://override.test")
        return Promise.resolve(
          Response.json({
            type: "oauth",
            access: "override-token",
            expires: 1_800_000,
            fedramp: false,
          }),
        )
      },
    }),
    throwOnError: true,
  })

  expect(response.data.access).toBe("override-token")
})
