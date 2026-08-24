import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
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

  test("revalidates unhashed assets", async () => {
    database = createTestDatabase().database
    const directory = `${process.env.TMPDIR ?? "/tmp"}/hena-app-v3-${crypto.randomUUID()}`
    await Bun.write(`${directory}/assets/logo.svg`, "<svg />")
    const response = await createApp({ database, publicDir: directory }).request("/assets/logo.svg")

    expect(response.headers.get("cache-control")).toBe("no-cache")
  })

  test("does not serve the SPA shell for missing assets", async () => {
    database = createTestDatabase().database
    const directory = `${process.env.TMPDIR ?? "/tmp"}/hena-app-v3-${crypto.randomUUID()}`
    await Bun.write(`${directory}/index.html`, "<main>app-v3</main>")

    const asset = await createApp({ database, publicDir: directory }).request("/assets/missing-a1b2c3.js")
    const file = await createApp({ database, publicDir: directory }).request("/missing.png")

    expect(asset.status).toBe(404)
    expect(asset.headers.get("cache-control")).toBeNull()
    expect(file.status).toBe(404)
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

  test("allows configured and same origins while rejecting other loopback origins", async () => {
    database = createTestDatabase().database
    const app = createApp({ database, corsOrigins: ["https://custom.example"] })
    const allowed = await app.request("/api/collection/capabilities", { headers: { origin: "https://app.hena.dev" } })
    const custom = await app.request("/api/collection/capabilities", { headers: { origin: "https://custom.example" } })
    const sameOrigin = await app.request("http://localhost/api/settings/profile/theme", {
      method: "PUT",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), value: "dark" }),
    })
    const devOrigin = await app.request("http://127.0.0.1:4106/api/collection/capabilities", {
      headers: { origin: "http://localhost:5173" },
    })
    const devIPOrigin = await app.request("http://127.0.0.1:4106/api/collection/capabilities", {
      headers: { origin: "http://127.0.0.1:5173" },
    })
    const otherLoopback = await app.request("http://127.0.0.1:4106/api/collection/capabilities", {
      headers: { origin: "http://localhost:5174" },
    })
    const rebound = await app.request("http://attacker.example/api/collection/capabilities", {
      headers: { origin: "http://attacker.example" },
    })
    const rejected = await app.request("/api/collection/capabilities", { headers: { origin: "https://evil.example" } })

    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.hena.dev")
    expect(custom.headers.get("access-control-allow-origin")).toBe("https://custom.example")
    expect(sameOrigin.status).toBe(200)
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBe("http://localhost")
    expect(devOrigin.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
    expect(devIPOrigin.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173")
    expect(otherLoopback.status).toBe(401)
    expect(otherLoopback.headers.get("access-control-allow-origin")).toBeNull()
    expect(rebound.status).toBe(401)
    expect(rejected.status).toBe(401)
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull()
    expect(await rejected.json()).toMatchObject({ error: { code: "unauthorized" } })
  })

  test("binds the unauthenticated server to loopback", () => {
    expect(Hostname).toBe("127.0.0.1")
  })

  test("starts against fresh and previously migrated databases", async () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.db`

    await runServer(path)
    await runServer(path)
    await Promise.all([path, `${path}-shm`, `${path}-wal`].map((file) => rm(file, { force: true })))
  }, 30_000)

  test("starts with an in-memory database", async () => {
    await runServer(":memory:")
  }, 30_000)

  test("passes configured CORS origins through standalone startup", async () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.db`
    await runServer(
      path,
      'import { start } from "./src/main.ts"; const instance = await start({ port: 0, publicDir: "/missing", corsOrigins: ["https://custom.example"] }); const response = await fetch(new URL("/api/collection/capabilities", instance.server.url), { headers: { origin: "https://custom.example" } }); await instance.stop(); if (response.headers.get("access-control-allow-origin") !== "https://custom.example") throw new Error("configured origin was rejected")',
    )
    await Promise.all([path, `${path}-shm`, `${path}-wal`].map((file) => rm(file, { force: true })))
  }, 30_000)

  test("loads CORS origins from standalone server configuration", async () => {
    const directory = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-config-${crypto.randomUUID()}`
    const path = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.db`
    await Bun.write(`${directory}/hena.jsonc`, '{\n  // Additional browser client.\n  "server": { "cors": ["https://configured.example",], },\n}')
    await runServer(
      path,
      'import { start } from "./src/main.ts"; const instance = await start({ port: 0, publicDir: "/missing" }); const response = await fetch(new URL("/api/collection/capabilities", instance.server.url), { headers: { origin: "https://configured.example" } }); await instance.stop(); if (response.headers.get("access-control-allow-origin") !== "https://configured.example") throw new Error("server.cors origin was rejected")',
      { HENA_CONFIG_DIR: directory },
    )
    await Promise.all([
      rm(directory, { force: true, recursive: true }),
      ...[path, `${path}-shm`, `${path}-wal`].map((file) => rm(file, { force: true })),
    ])
  }, 30_000)

  test("allows exact Vite development hosts", async () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.db`
    await runServer(
      path,
      'import { start } from "./src/main.ts"; const instance = await start({ port: 0, publicDir: "/missing" }); const response = await fetch(new URL("/api/collection/capabilities", instance.server.url), { headers: { origin: "http://hena.tailnet.test:5173" } }); await instance.stop(); if (response.headers.get("access-control-allow-origin") !== "http://hena.tailnet.test:5173") throw new Error("Vite development origin was rejected")',
      { HENA_VITE_ALLOWED_HOSTS: "hena.tailnet.test" },
    )
    await Promise.all([path, `${path}-shm`, `${path}-wal`].map((file) => rm(file, { force: true })))
  }, 30_000)

  test("keeps idle event streams alive and closes them during shutdown", async () => {
    await runServer(
      ":memory:",
      'import { start } from "./src/main.ts"; const instance = await start({ port: 0, publicDir: "/missing" }); const created = await fetch(new URL("/api/collection/streams", instance.server.url), { method: "POST" }).then((response) => response.json()); await fetch(new URL(`/api/collection/streams/${created.streamId}/subscription`, instance.server.url), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: 1, lists: false, sessions: [], cursors: {} }) }); const response = await fetch(new URL(`/api/collection/streams/${created.streamId}/events`, instance.server.url)); const reader = response.body.getReader(); await reader.read(); await Bun.sleep(11_000); if ((await reader.read()).done) throw new Error("idle stream disconnected"); await instance.stop();',
    )
  }, 30_000)
})

async function runServer(
  database: string,
  source = 'import { start } from "./src/main.ts"; const instance = await start({ port: 0, publicDir: "/missing" }); await instance.stop()',
  env?: Record<string, string>,
) {
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", source],
    cwd: resolve(import.meta.dir, ".."),
    env: { ...process.env, HENA_DB: database, ...env },
    stdout: "ignore",
    stderr: "pipe",
  })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(exitCode, stderr).toBe(0)
}
