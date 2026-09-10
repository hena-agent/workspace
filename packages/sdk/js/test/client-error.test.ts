import { expect, test } from "bun:test"
import { createHenaClient } from "../src/v2/client"
import { createClient } from "../src/v2/gen/client"

test("client-level throwOnError wraps server errors while a request can opt out", async () => {
  const body = { name: "NotFoundError", data: { message: "Session not found" } }
  const client = createHenaClient({
    baseUrl: "http://hena.test",
    throwOnError: true,
    fetch: async () => Response.json(body, { status: 404 }),
  })

  await expect(client.session.get({ sessionID: "missing" })).rejects.toMatchObject({
    message: "Session not found",
    cause: { body, status: 404 },
  })
  await expect(client.session.get({ sessionID: "missing" }, { throwOnError: undefined })).rejects.toHaveProperty(
    "message",
    "Session not found",
  )

  const result = await client.session.get({ sessionID: "missing" }, { throwOnError: false })
  expect(result.error).toEqual(body)
  expect(result.response?.status).toBe(404)
})

test("validation failures preserve resolved options for error interceptors", async () => {
  const failure = new Error("Invalid request")
  const client = createClient({
    baseUrl: "http://hena.test",
    headers: { "x-client-id": "client" },
    requestValidator: (options) => {
      options.headers.set("x-validated", "yes")
      throw failure
    },
  })
  const seen: unknown[] = []
  client.interceptors.error.use((error, response, request, options) => {
    expect(options.headers.get("x-client-id")).toBe("client")
    expect(options.headers.get("x-validated")).toBe("yes")
    expect(request).toBeUndefined()
    expect(response).toBeUndefined()
    seen.push(error)
    return error
  })
  const result = await client.get({ url: "/probe", throwOnError: false })
  expect(result.error).toBe(failure)
  expect(seen).toEqual([failure])
})

test("invalid headers fail without invoking interceptors that require resolved options", async () => {
  const client = createClient({ baseUrl: "http://hena.test" })
  const seen: unknown[] = []
  client.interceptors.error.use((error) => {
    seen.push(error)
    return error
  })
  const result = await client.get({ url: "/probe", headers: { "invalid\nheader": "value" }, throwOnError: false })
  expect(result.error).toBeInstanceOf(TypeError)
  expect(result.request).toBeUndefined()
  expect(result.response).toBeUndefined()
  expect(seen).toEqual([])
})

test.each([undefined, { "x-request-id": "request" }])(
  "error interceptors receive merged, normalized headers: %j",
  async (headers) => {
    const body = { message: "Server failed" }
    const client = createClient({
      baseUrl: "http://hena.test",
      headers: { "x-client-id": "client" },
      fetch: async () => Response.json(body, { status: 500 }),
    })
    client.interceptors.error.use((error, response, request, options) => {
      expect(options.headers).toBeInstanceOf(Headers)
      expect(options.headers.get("x-client-id")).toBe("client")
      expect(options.headers.get("x-request-id")).toBe(headers?.["x-request-id"] ?? null)
      expect(request?.headers.get("x-client-id")).toBe("client")
      expect(response?.status).toBe(500)
      return error
    })

    const result = await client.get({ url: "/probe", headers, throwOnError: false })
    expect(result.error).toEqual(body)
  },
)
