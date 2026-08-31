// Subprocess integration tests for `hena serve`. Spawns the real CLI and
// exercises it over HTTP — this is the only test tier that
// catches bugs spanning argv → server boot → routing → instance loading.
//
// `serve` is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The OS-assigned port is
// parsed off the "listening on http://..." line.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"

describe("hena serve (subprocess)", () => {
  // Smoke test: server starts, binds a port, and the v3 protocol responds.
  // If this fails, all other serve tests likely will too — debug here first.
  cliIt.live(
    "starts, binds a port, and serves v3 capabilities",
    ({ hena }) =>
      Effect.gen(function* () {
        const server = yield* hena.serve()
        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/^http:\/\//)

        const client = yield* HttpClient.HttpClient
        const res = yield* client.get(`${server.url}/api/collection/capabilities`)
        expect(res.status).toBe(200)
        const body = yield* res.json
        expect(body).toMatchObject({ protocol: { min: 1, max: 1 }, auth: "none" })
      }),
    60_000,
  )

  // The scope-close finalizer must actually terminate the child. Without this
  // test a regression in the kill path (e.g. a future refactor that forgets
  // to wire the finalizer) would leak processes on every test run.
  cliIt.live(
    "kills the subprocess on scope close",
    ({ hena }) =>
      Effect.gen(function* () {
        // Inner scope so we can observe `.exited` resolving after it closes.
        const exitedPromise = yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* hena.serve()
            // Capture the Promise, not the resolved value — scope closes after
            // this gen returns, at which point the finalizer kills the child.
            return server.exited
          }),
        )
        // After scope close: finalizer fired, process must have exited.
        const code = yield* Effect.promise(() => exitedPromise)
        // Bun reports the exit code; SIGTERM-killed processes return non-null
        // (typically 143 on POSIX). We just require resolution within a sane
        // window — anything else means the kill didn't take.
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )

  cliIt.live(
    "releases the port after SIGTERM",
    ({ hena }) =>
      Effect.gen(function* () {
        const first = yield* hena.serve()
        first.kill()
        yield* Effect.promise(() => first.exited)

        const replacement = yield* hena.serve({ port: first.port })
        expect(replacement.port).toBe(first.port)
      }),
    60_000,
  )

  cliIt.live(
    "reports unsupported password authentication",
    ({ hena }) =>
      Effect.gen(function* () {
        const result = yield* hena.spawn(["serve", "--port", "0"], {
          env: { HENA_SERVER_PASSWORD: "secret" },
        })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("HENA_SERVER_PASSWORD is not supported")
        expect(result.stderr).not.toContain("Unexpected error")
      }),
    60_000,
  )

  cliIt.live(
    "reports a port conflict with the --port flag",
    ({ hena }) =>
      Effect.gen(function* () {
        const running = yield* hena.serve()
        const result = yield* hena.spawn(["serve", "--port", String(running.port)])

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain(`Port ${running.port} is already in use`)
        expect(result.stderr).toContain("--port")
        expect(result.stderr).not.toContain("Unexpected error")
      }),
    60_000,
  )

  cliIt.live(
    "rejects unauthenticated non-loopback binding",
    ({ hena }) =>
      Effect.gen(function* () {
        const result = yield* hena.spawn(["serve", "--hostname", "0.0.0.0"])

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("only supports --hostname 127.0.0.1")
        expect(result.stderr).not.toContain("Unknown argument")
      }),
    60_000,
  )
})
