import { $ } from "bun"
import { ConfigV1 } from "@hena/core/v1/config/config"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Context, Layer } from "effect"
import type * as PlatformError from "effect/PlatformError"
import type * as Scope from "effect/Scope"
import { CrossSpawnSpawner } from "@hena/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { ChildProcessSpawner } from "effect/unstable/process"
import type { Config } from "@/config/config"
import { LayerNode } from "@hena/core/effect/layer-node"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import type { InstanceContext } from "../../src/project/instance-context"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { InstanceStore } from "../../src/project/instance-store"
import { TestLLMServer } from "../lib/llm-server"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
export const testInstanceStoreLayer = LayerNode.compile(InstanceStore.node, [
  [InstanceStore.bootstrapNode, noopBootstrap],
])

export async function provideTestInstance<R>(input: {
  directory: string
  init?: Effect.Effect<void>
  fn: (ctx: InstanceContext) => R
}) {
  const ctx = await InstanceRuntime.load({ directory: input.directory })
  try {
    if (input.init) await Effect.runPromise(input.init.pipe(Effect.provideService(InstanceRef, ctx)))
    return await input.fn(ctx)
  } finally {
    await InstanceRuntime.disposeInstance(ctx)
  }
}

export async function withTestInstance<R>(input: { directory: string; fn: (ctx: InstanceContext) => R }) {
  return input.fn(await InstanceRuntime.load({ directory: input.directory }))
}

export async function reloadTestInstance(input: { directory: string }) {
  return InstanceRuntime.reloadInstance(input)
}

export async function disposeAllInstances() {
  await InstanceRuntime.disposeAllInstances()
}

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

function clean(dir: string) {
  return fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

async function initializeGit(dir: string) {
  await $`git init`.cwd(dir).quiet()
  // Persist test-safe settings without paying for four more git processes per fixture.
  await fs.appendFile(
    path.join(dir, ".git", "config"),
    "\n[core]\n\tfsmonitor = false\n[commit]\n\tgpgsign = false\n[user]\n\temail = test@hena.test\n\tname = Test\n",
  )
  await $`git commit --allow-empty -m "root commit ${dir}"`.cwd(dir).quiet()
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<ConfigV1.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "hena-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) await initializeGit(dirpath)
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "hena.json"),
      JSON.stringify({
        $schema: "https://hena.dev/config.json",
        ...options.config,
      }),
    )
  }
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const extra = await options?.init?.(realpath)
  const result = {
    [Symbol.asyncDispose]: async () => {
      try {
        await options?.dispose?.(realpath)
      } finally {
        await clean(realpath).catch(() => undefined)
      }
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}

/** Effectful scoped tmpdir. Cleaned up when the scope closes. Make sure these stay in sync */
export function tmpdirScoped<E = never, R = never>(options?: {
  git?: boolean
  config?: Partial<ConfigV1.Info> | (() => Partial<ConfigV1.Info>)
  init?: (directory: string) => Effect.Effect<void, E, R>
}) {
  return Effect.gen(function* () {
    const dirpath = sanitizePath(path.join(os.tmpdir(), "hena-test-" + Math.random().toString(36).slice(2)))
    yield* Effect.promise(() => fs.mkdir(dirpath, { recursive: true }))
    const dir = sanitizePath(yield* Effect.promise(() => fs.realpath(dirpath)))

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await clean(dir).catch(() => undefined)
      }),
    )

    if (options?.git) yield* Effect.promise(() => initializeGit(dir))

    if (options?.config) {
      const resolved = typeof options.config === "function" ? options.config() : options.config
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(dir, "hena.json"),
          JSON.stringify({ $schema: "https://hena.dev/config.json", ...resolved }),
        ),
      )
    }

    if (options?.init) yield* options.init(dir)

    return dir
  })
}

export const provideInstance =
  (directory: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | InstanceStore.Service> =>
    InstanceStore.Service.use((store) => store.provide({ directory }, self))

export const provideInstanceEffect =
  (directory: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | InstanceStore.Service> =>
    InstanceStore.Service.use((store) => store.provide({ directory }, self))

export const reloadInstance = (input: InstanceStore.LoadInput) =>
  InstanceStore.Service.use((store) => store.reload(input))

export const disposeAllInstancesEffect = InstanceStore.Service.use((store) => store.disposeAll())

export function provideTmpdirInstance<A, E, R>(
  self: (path: string) => Effect.Effect<A, E, R>,
  options?: { git?: boolean; config?: Partial<ConfigV1.Info> | (() => Partial<ConfigV1.Info>) },
) {
  return Effect.gen(function* () {
    const path = yield* tmpdirScoped(options)
    return yield* self(path).pipe(provideInstance(path))
  }).pipe(Effect.provide(testInstanceStoreLayer))
}

export class TestInstance extends Context.Service<TestInstance, { readonly directory: string }>()("@test/Instance") {}

export const requireInstance = Effect.gen(function* () {
  const instance = yield* InstanceRef
  if (!instance) return yield* Effect.die(new Error("missing test instance"))
  return instance
})

export const withTmpdirInstance =
  <E2 = never, R2 = never>(options?: {
    git?: boolean
    config?: Partial<ConfigV1.Info> | (() => Partial<ConfigV1.Info>)
    init?: (directory: string) => Effect.Effect<void, E2, R2>
  }) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped(options)
      return yield* self.pipe(Effect.provideService(TestInstance, { directory }), provideInstanceEffect(directory))
    }).pipe(Effect.provide(testInstanceStoreLayer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)))

export function provideTmpdirServer<A, E, R>(
  self: (input: { dir: string; llm: TestLLMServer["Service"] }) => Effect.Effect<A, E, R>,
  options?: { git?: boolean; config?: (url: string) => Partial<ConfigV1.Info> },
): Effect.Effect<
  A,
  E | PlatformError.PlatformError,
  R | TestLLMServer | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    return yield* provideTmpdirInstance((dir) => self({ dir, llm }), {
      git: options?.git,
      config: options?.config?.(llm.url),
    })
  })
}
