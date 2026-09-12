import { strict } from "node:assert"
import { setTimeout } from "node:timers/promises"

const init = Promise.withResolvers<{ url: string }>()
const storage = Promise.withResolvers<void>()
const health = Promise.withResolvers<void>()
const bootstrap = Promise.withResolvers<void>()
const calls: string[] = []
const ipc: string[] = []
const data = new Map<string, string>()
const session = {
  id: "ses_fixture",
  projectID: "prj_fixture",
  directory: "/empty",
  title: "Cold session",
  version: "test",
  time: { created: 1, updated: 1 },
  metadata: { appRuntime: "canonical" },
}
const project = {
  id: "prj_fixture",
  worktree: "/empty",
  mode: "chat",
  sandboxes: [],
  time: { created: 1, updated: 1 },
}
// Restore only the route. All persisted provider stores and query caches start empty.
localStorage.clear()
localStorage.setItem("hena.desktop.window.isolated.last-active-url", "/server/c2lkZWNhcg/session/ses_fixture")
const root = document.createElement("div")
root.id = "root"
document.body.append(root)

// The entrypoint reads IPC and fetch directly. These replacements are confined
// to the spawned process; no call can reach Electron or a live server.
Object.defineProperty(window, "api", {
  value: {
    async getWindowID() {
      return "isolated"
    },
    async getWindowCount() {
      return 1
    },
    awaitInitialization() {
      ipc.push("initialization")
      return init.promise
    },
    async getDefaultServerUrl() {
      return null
    },
    async storeGet(name: string, key: string) {
      await storage.promise
      return data.get(`${name}:${key}`) ?? null
    },
    async storeSet(name: string, key: string, value: string) {
      data.set(`${name}:${key}`, value)
    },
    async storeDelete(name: string, key: string) {
      data.delete(`${name}:${key}`)
    },
    async getPinchZoomEnabled() {
      return false
    },
    async consumeInitialDeepLinks() {
      return []
    },
    onZoomFactorChanged() {},
    onPinchZoomEnabledChanged() {},
    onMenuCommand() {},
    onDeepLink() {},
    updater: {
      async subscribe() {
        return () => {}
      },
    },
    async setTitlebar() {},
    async setBackgroundColor() {},
    async isOldLayoutEligible() {
      return false
    },
    async isFirstLaunchOnboardingPending() {
      ipc.push("onboarding")
      return false
    },
    async recordFatalRendererError(error: unknown) {
      throw new Error(JSON.stringify(error))
    },
  },
})

const history = "/api/session/ses_fixture/message"
const responses: Record<string, unknown> = {
  "/global/config": {},
  "/provider": { all: [], connected: [], default: {} },
  "/path": { home: "/empty", state: "/empty", config: "/empty", directory: "/empty", worktree: "/empty" },
  "/project": [project],
  "/api/session": { data: [], cursor: {} },
  "/session/ses_fixture": session,
  "/session": [],
  "/project/current": project,
  "/api/model": { data: [] },
  "/agent": [],
  "/config": {},
  "/session/status": {},
  "/vcs": {},
  "/command": [],
  "/permission": [],
  "/question": [],
  "/api/question/request": { data: [] },
  "/api/reference": { data: [] },
  "/mcp": {},
  "/lsp": [],
  "/experimental/resource": {},
  [history]: { data: [], cursor: {} },
  "/session/ses_fixture/todo": [],
  "/session/ses_fixture/diff": [],
}
globalThis.fetch = async (input: Request | string | URL) => {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  strict.equal(url.origin, "http://cold-start.invalid")
  calls.push(url.pathname)
  if (url.pathname === "/global/health") {
    await health.promise
    return Response.json({ healthy: true, version: "test" })
  }
  if (url.pathname === "/global/event") {
    return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } })
  }
  strict.ok(url.pathname in responses, `Unexpected request ${url.pathname}`)
  // Hold bootstrap independently of session resolution so history admission
  // must join the still-running bootstrap query, rather than skip its await.
  if (url.pathname === "/project") await bootstrap.promise
  return Response.json(responses[url.pathname])
}

async function until(check: () => boolean, message: string) {
  const deadline = performance.now() + 2_000
  while (!check() && performance.now() < deadline) await setTimeout(5)
  strict.ok(check(), message)
}

await import("../../../desktop/src/renderer/index")
await until(() => ipc.includes("initialization"), "initialization IPC must start")
strict.equal(calls.length, 0)
init.resolve({ url: "http://cold-start.invalid" })
storage.resolve()
await until(() => calls.includes("/global/health"), "health check must start")
health.resolve()
await until(
  () => calls.includes("/api/model") && ipc.includes("onboarding"),
  "restored route and onboarding must initialize",
)
// Drain async session resolution while project bootstrap remains pending.
for (let i = 0; i < 20; i++) await setTimeout(0)
strict.ok(!calls.includes(history), "history must wait for project bootstrap")
strict.equal(root.querySelector('[contenteditable="true"]'), null)
bootstrap.resolve()
console.log("bootstrap released")
await until(() => !!root.querySelector('[contenteditable="true"]'), "restored session composer must mount").finally(
  () => console.log(`history requests: ${calls.filter((path) => path === history).length}`),
)
strict.ok(root.querySelector('[data-slot="titlebar-v2"]'))
strict.ok(root.textContent?.includes("Cold session"))
strict.equal(calls.filter((path) => path === history).length, 1)
console.log("cold desktop session mounted")
// The production entrypoint owns polling timers and does not expose disposal.
process.exit(0)
