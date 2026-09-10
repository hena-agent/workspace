import { expect, test } from "bun:test"
import { createHenaClient } from "../src/v2/client"

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

  const result = await client.session.get({ sessionID: "missing" }, { throwOnError: false })
  expect(result.error).toEqual(body)
  expect(result.response?.status).toBe(404)
})
