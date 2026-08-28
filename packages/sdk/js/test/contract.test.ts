import { expect, test } from "bun:test"

test("published SDK omits removed TUI surfaces", async () => {
  const client = await import("../src/client")
  const server = await import("../src/server")
  const v2Client = await import("../src/v2/client")
  const v2Server = await import("../src/v2/server")

  expect("tui" in client.createHenaClient()).toBe(false)
  expect("tui" in v2Client.createHenaClient()).toBe(false)
  expect("createHenaTui" in server).toBe(false)
  expect("createHenaTui" in v2Server).toBe(false)
})
