import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import path from "node:path"
import { tmpdirScoped } from "../../fixture/fixture"
import { awaitWithTimeout, it, pollWithTimeout } from "../../lib/effect"

it.live(
  "dev server serves legacy App routes while serve uses V3, and shuts down cleanly",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        HENA_TEST_HOME: home,
        HENA_TEST_MANAGED_CONFIG_DIR: path.join(home, "managed"),
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_DATA_HOME: path.join(home, "data"),
        XDG_STATE_HOME: path.join(home, "state"),
        XDG_CACHE_HOME: path.join(home, "cache"),
        HENA_DB: path.join(home, "hena.db"),
        HENA_CONFIG_CONTENT: JSON.stringify({ enabled_providers: [], plugin: [] }),
        HENA_AUTH_CONTENT: "{}",
        HENA_PURE: "1",
        HENA_DISABLE_PROJECT_CONFIG: "1",
        HENA_DISABLE_AUTOUPDATE: "1",
        HENA_DISABLE_AUTOCOMPACT: "1",
        HENA_DISABLE_MODELS_FETCH: "1",
        HENA_MODELS_PATH: path.resolve(import.meta.dir, "../../tool/fixtures/models-api.json"),
      }

      for (const mode of ["SIGINT", "SIGTERM", "v3"] as const) {
        const legacy = mode !== "v3"
        yield* Effect.scoped(
          Effect.gen(function* () {
            // Server.listen({ port: 0 }) prefers 4096. Reserve an OS-assigned
            // alternate port instead, and fail rather than evict an occupant.
            const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
            const port = reservation.port!
            yield* Effect.promise(() => reservation.stop(true))
            expect(port).not.toBe(4096)
            const url = `http://127.0.0.1:${port}`
            const child = yield* Effect.acquireRelease(
              Effect.sync(() =>
                Bun.spawn(
                  [
                    process.execPath,
                    "run",
                    "--conditions=browser",
                    path.resolve(import.meta.dir, legacy ? "../../../script/dev-server.ts" : "../../../src/index.ts"),
                    ...(legacy ? [] : ["serve"]),
                    "--port",
                    String(port),
                  ],
                  { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
                ),
              ),
              (child) =>
                Effect.promise(async () => {
                  if (child.exitCode === null) child.kill("SIGKILL")
                  await child.exited
                }),
            )
            const output: string[] = []
            yield* Effect.forEach([child.stdout, child.stderr], (stream) =>
              Stream.fromReadableStream({ evaluate: () => stream, onError: (cause) => cause }).pipe(
                Stream.decodeText(),
                Stream.runForEach((chunk) => Effect.sync(() => void output.push(chunk))),
                Effect.forkScoped,
              ),
            )
            yield* pollWithTimeout(
              Effect.sync(() => {
                if (child.exitCode !== null) throw new Error(output.join(""))
                return output.join("").includes(`listening on ${url}`) ? true : undefined
              }),
              "server did not announce readiness",
              "30 seconds",
            )
            const health = yield* Effect.promise(() => fetch(`${url}/global/health`))
            if (legacy) {
              expect(health.status).toBe(200)
              expect(health.headers.get("content-type")).toContain("application/json")
              expect(yield* Effect.promise(() => health.json())).toEqual({ healthy: true, version: expect.any(String) })
              for (const route of ["/global/config", "/path", "/provider"]) {
                const response = yield* Effect.promise(() =>
                  fetch(`${url}${route}`, { headers: { Origin: "http://localhost:4444" } }),
                )
                expect(response.status).toBe(200)
                expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:4444")
                expect(yield* Effect.promise(() => response.json())).toBeObject()
              }
            }
            if (!legacy) {
              expect(yield* Effect.promise(() => health.text())).not.toContain('"healthy":true')
              const capabilities = yield* Effect.promise(() => fetch(`${url}/api/collection/capabilities`))
              expect(capabilities.status).toBe(200)
              expect(yield* Effect.promise(() => capabilities.json())).toMatchObject({
                protocol: { min: 1, max: 1 },
                auth: "none",
              })
            }
            child.kill(mode === "v3" ? "SIGTERM" : mode)
            expect(
              yield* awaitWithTimeout(
                Effect.promise(() => child.exited),
                "server did not stop",
                "10 seconds",
              ),
            ).toBe(0)
          }),
        )
      }
    }),
  90_000,
)
