import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"
import { Hostname } from "../src/main"

describe("serving", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("serves SPA routes with no-cache", async () => {
    database = createTestDatabase().database
    const directory = `${process.env.TMPDIR ?? "/tmp"}/hena-app-v3-${crypto.randomUUID()}`
    await Bun.write(`${directory}/index.html`, "<main>app-v3</main>")
    const response = await createApp({ database, publicDir: directory }).request("/server/project/session/id")

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(await response.text()).toBe("<main>app-v3</main>")
  })

  test("caches hashed assets immutably", async () => {
    database = createTestDatabase().database
    const directory = `${process.env.TMPDIR ?? "/tmp"}/hena-app-v3-${crypto.randomUUID()}`
    await Bun.write(`${directory}/assets/app-a1b2c3.js`, "export {}")
    const response = await createApp({ database, publicDir: directory }).request("/assets/app-a1b2c3.js")

    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
  })

  test("compresses large static responses", async () => {
    database = createTestDatabase().database
    const directory = `${process.env.TMPDIR ?? "/tmp"}/hena-app-v3-${crypto.randomUUID()}`
    await Bun.write(`${directory}/index.html`, `<main>${"content".repeat(500)}</main>`)
    const response = await createApp({ database, publicDir: directory }).request("/", {
      headers: { "accept-encoding": "gzip" },
    })

    expect(response.headers.get("content-encoding")).toBe("gzip")
  })

  test("explains a missing build", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database, publicDir: "/path/that/does/not/exist" }).request("/")

    expect(response.status).toBe(503)
    expect(await response.text()).toContain("bun run build")
  })

  test("allows configured origins and rejects unknown origins", async () => {
    database = createTestDatabase().database
    const app = createApp({ database, corsOrigins: ["https://app.hena.dev"] })
    const allowed = await app.request("/api/collection/capabilities", { headers: { origin: "https://app.hena.dev" } })
    const rejected = await app.request("/api/collection/capabilities", { headers: { origin: "https://evil.example" } })

    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.hena.dev")
    expect(rejected.status).toBe(401)
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull()
    expect(await rejected.json()).toMatchObject({ error: { code: "unauthorized" } })
  })

  test("binds the unauthenticated server to loopback", () => {
    expect(Hostname).toBe("127.0.0.1")
  })
})
