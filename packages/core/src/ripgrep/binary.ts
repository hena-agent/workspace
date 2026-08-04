import path from "path"
import { Context, Effect, Layer, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../cross-spawn-spawner"
import { makeGlobalNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { EffectFlock } from "../util/effect-flock"
import { which } from "../util/which"

export namespace RipgrepBinary {
  const VERSION = "15.1.0"
  const PLATFORM = {
    "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
    "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
    "ia32-win32": { platform: "i686-pc-windows-msvc", extension: "zip" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
  } as const

  interface Interface {
    readonly filepath: Effect.Effect<string, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@hena/RipgrepBinary") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const flock = yield* EffectFlock.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const spawner = yield* ChildProcessSpawner

      const run = Effect.fnUntraced(function* (command: string, args: string[]) {
        const handle = yield* spawner.spawn(ChildProcess.make(command, args, { extendEnv: true, stdin: "ignore" }))
        const [stdout, stderr, code] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(handle.stdout)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        )
        return { stdout, stderr, code }
      }, Effect.scoped)

      const extract = Effect.fnUntraced(function* (
        archive: string,
        bytes: Uint8Array,
        config: (typeof PLATFORM)[keyof typeof PLATFORM],
        target: string,
      ) {
        const dir = yield* fs.makeTempDirectoryScoped({ directory: Global.Path.bin, prefix: "ripgrep-" })
        const extracted = path.join(
          dir,
          `ripgrep-${VERSION}-${config.platform}`,
          process.platform === "win32" ? "rg.exe" : "rg",
        )

        if (config.extension === "zip") {
          const { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } = yield* Effect.promise(
            () => import("@zip.js/zip.js"),
          )
          const reader = yield* Effect.acquireRelease(
            Effect.sync(
              () =>
                new ZipReader(new Uint8ArrayReader(bytes), {
                  checkSignature: true,
                  useWebWorkers: false,
                }),
            ),
            (reader) => Effect.promise(() => reader.close()).pipe(Effect.ignore),
          )
          const expected = `ripgrep-${VERSION}-${config.platform}/rg.exe`
          const entry = (yield* Effect.promise(() => reader.getEntries())).find((entry) => entry.filename === expected)
          if (!entry?.getData) throw new Error(`ripgrep archive did not contain executable: ${expected}`)
          const data = yield* Effect.promise(() => entry.getData!(new Uint8ArrayWriter()))
          yield* fs.writeWithDirs(extracted, data)
        }

        if (config.extension === "tar.gz") {
          const result = yield* run("tar", ["-xzf", archive, "-C", dir])
          if (result.code !== 0)
            throw new Error(
              result.stderr.trim() || result.stdout.trim() || `ripgrep extraction failed with code ${result.code}`,
            )
        }

        if (!(yield* fs.isFile(extracted))) throw new Error(`ripgrep archive did not contain executable: ${extracted}`)

        if (process.platform !== "win32") yield* fs.chmod(extracted, 0o755)
        yield* fs.rename(extracted, target)
      }, Effect.scoped)

      return Service.of({
        filepath: yield* Effect.cached(
          Effect.gen(function* () {
            const system = yield* Effect.sync(() => which(process.platform === "win32" ? "rg.exe" : "rg"))
            if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

            const target = path.join(Global.Path.bin, `rg${process.platform === "win32" ? ".exe" : ""}`)
            if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

            return yield* flock.withLock(
              Effect.gen(function* () {
                if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

                const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
                const config = PLATFORM[platformKey]
                if (!config) throw new Error(`unsupported platform for ripgrep: ${platformKey}`)

                const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
                const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`

                yield* Effect.logInfo("downloading ripgrep", { url })
                yield* fs.ensureDir(Global.Path.bin).pipe(Effect.orDie)
                const dir = yield* fs.makeTempDirectoryScoped({
                  directory: Global.Path.bin,
                  prefix: "ripgrep-download-",
                })
                const archive = path.join(dir, filename)
                const bytes = yield* HttpClientRequest.get(url).pipe(
                  http.execute,
                  Effect.flatMap((response) => response.arrayBuffer),
                  Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
                )
                if (bytes.byteLength === 0) throw new Error(`failed to download ripgrep from ${url}`)

                const archiveBytes = new Uint8Array(bytes)
                yield* fs.writeFile(archive, archiveBytes)
                yield* extract(archive, archiveBytes, config, target)
                return target
              }).pipe(Effect.scoped),
              `ripgrep-install:${target}`,
            )
          }),
        ),
      })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [EffectFlock.node, FSUtil.node, httpClient, CrossSpawnSpawner.node],
  })
}
