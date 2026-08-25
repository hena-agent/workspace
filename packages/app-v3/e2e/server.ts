import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

const directory = await mkdtemp(path.join(tmpdir(), "hena-app-v3-e2e-"))
const originalAuth = await Bun.file(path.join(homedir(), ".local/share/opencode/auth.json"))
  .json()
  .catch(() => undefined) as Record<string, unknown> | undefined
const ciAuth = process.env.OPENCODE_GO_AUTH_JSON
  ? JSON.parse(process.env.OPENCODE_GO_AUTH_JSON) as unknown
  : undefined
const auth = ciAuth ?? originalAuth?.["opencode-go"]

process.env.XDG_DATA_HOME = path.join(directory, "data")
process.env.XDG_CACHE_HOME = path.join(directory, "cache")
process.env.XDG_CONFIG_HOME = path.join(directory, "config")
process.env.XDG_STATE_HOME = path.join(directory, "state")
process.env.HENA_CONFIG_DIR = path.join(directory, "config", "hena")
process.env.HENA_DB = path.join(directory, "hena.db")

if (auth) {
  await mkdir(path.join(directory, "data", "hena"), { recursive: true })
  await writeFile(path.join(directory, "data", "hena", "auth.json"), JSON.stringify({ "opencode-go": auth }), { mode: 0o600 })
}

const { start } = await import("../../server-v3/src/main")
const running = await start({
  port: Number(process.env.E2E_PORT ?? 4117),
  publicDir: path.resolve(import.meta.dir, "../dist"),
  corsOrigins: ["http://127.0.0.1:4117", "http://127.0.0.1:4118"],
})
let cleaning = false
const cleanup = async () => {
  if (cleaning) return
  cleaning = true
  await running.stop()
  await rm(directory, { recursive: true, force: true })
}
process.once("SIGINT", cleanup)
process.once("SIGTERM", cleanup)
