export * as Config from "./config"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { type ParseError, parse } from "jsonc-parser"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Permission } from "@hena/schema/permission"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { Policy } from "./policy"
import { AbsolutePath, NonNegativeInt } from "./schema"
import { ConfigAgent } from "./config/agent"
import { ConfigAttachments } from "./config/attachments"
import { ConfigCompaction } from "./config/compaction"
import { ConfigCommand } from "./config/command"
import { ConfigExperimental } from "./config/experimental"
import { ConfigFormatter } from "./config/formatter"
import { ConfigLSP } from "./config/lsp"
import { ConfigMCP } from "./config/mcp"
import { ConfigPlugin } from "./config/plugin"
import { ConfigProvider } from "./config/provider"
import { ConfigReference } from "./config/reference"
import { ConfigToolOutput } from "./config/tool-output"
import { ConfigWatcher } from "./config/watcher"
import { ConfigV1 } from "./v1/config/config"
import { ConfigMigrateV1 } from "./v1/config/migrate"
import { Credential } from "./credential"
import { Integration } from "@hena/schema/integration"
import { Hash } from "./util/hash"

export class Info extends Schema.Class<Info>("Config.Info")({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.String.pipe(Schema.optional).annotate({
    description: "Default shell to use for terminal and shell tool execution",
  }),
  model: Schema.String.pipe(Schema.optional).annotate({
    description: "Default model to use when no session or agent model is selected",
  }),
  default_agent: Schema.String.pipe(Schema.optional).annotate({
    description: "Default primary agent to use when no session agent is selected",
  }),
  autoupdate: Schema.Union([Schema.Boolean, Schema.Literal("notify")])
    .pipe(Schema.optional)
    .annotate({
      description: "Automatically update or notify when a new version is available",
    }),
  share: Schema.Literals(["manual", "auto", "disabled"]).pipe(Schema.optional).annotate({
    description: "Control whether sessions may be shared manually, automatically, or not at all",
  }),
  enterprise: Schema.Struct({
    url: Schema.String.pipe(Schema.optional),
  })
    .pipe(Schema.optional)
    .annotate({
      description: "Enterprise sharing service configuration",
    }),
  username: Schema.String.pipe(Schema.optional).annotate({
    description: "Username displayed in conversations and used for telemetry identity",
  }),
  permissions: Permission.Ruleset.pipe(Schema.optional).annotate({
    description: "Ordered tool permission rules applied to agent tool use",
  }),
  agents: Schema.Record(Schema.String, ConfigAgent.Info).pipe(Schema.optional).annotate({
    description: "Named built-in agent overrides and custom agent definitions",
  }),
  snapshots: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable snapshots used for undo and revert behavior",
  }),
  watcher: ConfigWatcher.Info.pipe(Schema.optional).annotate({
    description: "Filesystem watcher configuration",
  }),
  formatter: ConfigFormatter.Info.pipe(Schema.optional).annotate({
    description: "Enable built-in formatters or configure formatter overrides",
  }),
  lsp: ConfigLSP.Info.pipe(Schema.optional).annotate({
    description: "Enable built-in language servers or configure server overrides",
  }),
  attachments: ConfigAttachments.Info.pipe(Schema.optional).annotate({
    description: "Attachment processing configuration",
  }),
  tool_output: ConfigToolOutput.Info.pipe(Schema.optional).annotate({
    description: "Tool output truncation thresholds",
  }),
  mcp: ConfigMCP.Info.pipe(Schema.optional).annotate({
    description: "MCP server configuration",
  }),
  compaction: ConfigCompaction.Info.pipe(Schema.optional).annotate({
    description: "Conversation compaction behavior",
  }),
  skills: Schema.String.pipe(Schema.Array, Schema.optional).annotate({
    description: "Additional paths or URLs to discover skills from",
  }),
  commands: Schema.Record(Schema.String, ConfigCommand.Info).pipe(Schema.optional).annotate({
    description: "Named slash command definitions",
  }),
  instructions: Schema.String.pipe(Schema.Array, Schema.optional).annotate({
    description: "Additional paths or URLs supplying ambient instructions",
  }),
  references: ConfigReference.Info.pipe(Schema.optional).annotate({
    description: "Named local directories or Git repositories available as external context",
  }),
  plugins: ConfigPlugin.Plugins.pipe(Schema.optional).annotate({
    description: "Ordered external plugin packages to load",
  }),
  experimental: ConfigExperimental.Experimental.pipe(Schema.optional),
  providers: Schema.Record(Schema.String, ConfigProvider.Info).pipe(Schema.optional),
}) {}

export class Document extends Schema.Class<Document>("Config.Document")({
  type: Schema.Literal("document"),
  path: Schema.String.pipe(Schema.optional),
  info: Info,
}) {}

export class Directory extends Schema.Class<Directory>("Config.Directory")({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
}) {}

export type Entry = Document | Directory

export function latest<K extends keyof Info>(entries: readonly Entry[], key: K): Info[K] | undefined {
  return entries
    .filter((entry): entry is Document => entry.type === "document")
    .findLast((entry) => entry.info[key] !== undefined)?.info[key]
}

export type LegacyCredentialRef = {
  readonly id: Credential.ID
  readonly integrationID: Integration.ID
  readonly label: string
  readonly type: Credential.Value["type"]
  readonly methodID?: Integration.MethodID
}

export interface Interface {
  /** Returns location config documents and supplemental directories from lowest to highest priority. */
  readonly entries: () => Effect.Effect<Entry[]>
  /** Resolves secrets discovered in read-only OpenCode compatibility sources. */
  readonly credential?: {
    readonly list: () => Effect.Effect<ReadonlyArray<LegacyCredentialRef>>
    readonly resolve: (id: Credential.ID) => Effect.Effect<Credential.Value | undefined>
  }
}

export class Service extends Context.Service<Service, Interface>()("@hena/v2/Config") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const policy = yield* Policy.Service
    const names = ["hena.json", "hena.jsonc"]
    const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
    const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
    const decodeV1Info = Schema.decodeUnknownOption(ConfigV1.Info, decodeOptions)
    const decodeLegacyAuth = Schema.decodeUnknownOption(LegacyAuthValue)
    const legacyCredentials = new Map<Credential.ID, { ref: LegacyCredentialRef; value: Credential.Value }>()
    const legacyCompatibility = new Map<Integration.ID, Credential.Compatibility>()

    const setLegacyCredential = (providerID: string, value: Credential.Value, label = "OpenCode") => {
      const integrationID = Integration.ID.make(providerID.replace(/\/+$/, ""))
      const id = Credential.ID.make(
        value.type === "oauth"
          ? `legacy:${integrationID}:${Hash.fast(`${label}:${value.refresh}`)}`
          : `legacy:${integrationID}`,
      )
      for (const [key, entry] of legacyCredentials) {
        if (entry.ref.integrationID === integrationID) legacyCredentials.delete(key)
      }
      legacyCredentials.set(id, {
        ref: {
          id,
          integrationID,
          label,
          type: value.type,
          methodID: value.type === "oauth" ? value.methodID : undefined,
        },
        value,
      })
    }

    const loadFile = Effect.fnUntraced(function* (filepath: string, legacy: boolean) {
      const text = yield* fs.readFileStringSafe(filepath)
      if (!text) return

      const errors: ParseError[] = []
      const input: unknown = parse(text, errors, { allowTrailingComma: true })
      if (errors.length) return

      const v1 = legacy || ConfigMigrateV1.isV1(input) ? Option.getOrUndefined(decodeV1Info(input)) : undefined
      if (legacy && !v1) return
      const result = v1 && legacy ? migrateLegacy(v1) : undefined
      for (const providerID of result?.unsupported ?? []) {
        yield* Effect.logError(`Ignoring OpenCode provider ${providerID}: unsupported secret configuration`)
      }
      for (const [providerID, credential] of result?.credentials ?? []) {
        if (
          credential.type === "key" &&
          !credential.key &&
          [...legacyCredentials.values()].some((entry) => entry.ref.integrationID === providerID.replace(/\/+$/, ""))
        )
          continue
        setLegacyCredential(providerID, credential)
      }
      for (const [providerID, compatibility] of result?.compatibility ?? []) {
        const integrationID = Integration.ID.make(providerID.replace(/\/+$/, ""))
        legacyCompatibility.set(
          integrationID,
          mergeCompatibility(legacyCompatibility.get(integrationID), compatibility),
        )
      }
      const migrated = v1 ? (result ? result.info : ConfigMigrateV1.migrate(v1)) : undefined
      const info = Option.getOrUndefined(migrated ? decodeInfo(migrated) : decodeInfo(input))
      if (!info) return
      return new Document({ type: "document", path: filepath, info })
    })

    const loadDirectory = Effect.fnUntraced(function* (directory: AbsolutePath) {
      return [
        ...(yield* Effect.forEach(names, (file) => loadFile(path.join(directory, file), false)).pipe(
          Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
        )),
        new Directory({ type: "directory", path: directory }),
      ]
    })

    const loadLegacyDirectory = Effect.fnUntraced(function* (directory: string) {
      return yield* Effect.forEach(["opencode.json", "opencode.jsonc"], (file) =>
        loadFile(path.join(directory, file), true),
      ).pipe(Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)))
    })

    const globalDirectory = AbsolutePath.make(global.config)
    const locationIsGlobal = path.resolve(location.directory) === path.resolve(global.config)
    const useOpenCodeGlobal =
      path.resolve(global.config) ===
      path.join(process.env.XDG_CONFIG_HOME ?? path.join(global.home, ".config"), "hena")
    // Read configuration once when this location opens. Later calls reuse these
    // values until the location is reopened.
    const discovered = locationIsGlobal
      ? []
      : yield* fs
          .up({
            targets: [".hena", ...names.toReversed()],
            start: location.directory,
            stop: location.project.directory,
          })
          .pipe(Effect.orDie)
    const directories = [
      globalDirectory,
      ...discovered
        .filter((item) => path.basename(item) === ".hena")
        .toReversed()
        .map((directory) => AbsolutePath.make(directory)),
    ]
    // A config closer to the opened directory should win over one higher up.
    // Search starts nearby, so reverse the results before applying them.
    const directPaths = discovered.filter((item) => path.basename(item) !== ".hena").toReversed()
    const direct = yield* Effect.forEach(directPaths, (filepath) => loadFile(filepath, false)).pipe(
      Effect.orDie,
      Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
    )
    const supplementary = yield* Effect.forEach(directories, loadDirectory).pipe(Effect.orDie)
    const legacyConfigDirectories = [
      ...(useOpenCodeGlobal
        ? [
            process.env.OPENCODE_CONFIG_DIR,
            path.join(process.env.XDG_CONFIG_HOME ?? path.join(global.home, ".config"), "opencode"),
            path.join(global.home, ".opencode"),
          ]
        : [process.env.OPENCODE_CONFIG_DIR]),
      ...(locationIsGlobal
        ? []
        : (yield* fs
            .up({ targets: [".opencode"], start: location.directory, stop: location.project.directory })
            .pipe(Effect.orDie)).toReversed()),
    ].filter((directory): directory is string => directory !== undefined)
    const legacyDirectPaths = locationIsGlobal
      ? []
      : (yield* fs
          .up({
            targets: ["opencode.jsonc", "opencode.json"],
            start: location.directory,
            stop: location.project.directory,
          })
          .pipe(Effect.orDie)).toReversed()
    const loadLegacyAuth = Effect.fnUntraced(function* (legacyAuthText: string | undefined, label: string) {
      if (!legacyAuthText) return
      const errors: ParseError[] = []
      const input: unknown = parse(legacyAuthText, errors)
      const auth = !errors.length && typeof input === "object" && input !== null && !Array.isArray(input) ? input : {}
      for (const [providerID, input] of Object.entries(auth)) {
        const value = Option.getOrUndefined(decodeLegacyAuth(input))
        if (!value) continue
        if (value.type === "api") {
          setLegacyCredential(
            providerID,
            Credential.Key.make({ type: "key", key: value.key, metadata: value.metadata }),
            label,
          )
          continue
        }
        if (value.type !== "oauth") continue
        const methodID = Integration.MethodID.make(providerID === "openai" ? "chatgpt-browser" : "oauth")
        setLegacyCredential(
          providerID,
          Credential.OAuth.make({
            type: "oauth",
            methodID,
            refresh: value.refresh,
            access: value.access,
            expires: value.expires,
            metadata: {
              ...(value.accountId ? { accountID: value.accountId } : {}),
              ...(value.enterpriseUrl ? { enterpriseURL: value.enterpriseUrl } : {}),
            },
          }),
          label,
        )
      }
    })
    yield* loadLegacyAuth(
      process.env.OPENCODE_AUTH_CONTENT?.trim() ||
        (useOpenCodeGlobal
          ? yield* fs
              .readFileStringSafe(
                path.join(
                  process.env.XDG_DATA_HOME ?? path.join(global.home, ".local", "share"),
                  "opencode",
                  "auth.json",
                ),
              )
              .pipe(Effect.orDie)
          : undefined),
      "OpenCode",
    )
    yield* loadLegacyAuth(
      process.env.HENA_AUTH_CONTENT?.trim() ||
        (useOpenCodeGlobal
          ? yield* fs.readFileStringSafe(path.join(global.data, "auth.json")).pipe(Effect.orDie)
          : undefined),
      "Hena",
    )
    const legacySupplementary = yield* Effect.forEach(legacyConfigDirectories, loadLegacyDirectory).pipe(Effect.orDie)
    const legacyDirect = yield* Effect.forEach(legacyDirectPaths, (filepath) => loadFile(filepath, true)).pipe(
      Effect.orDie,
      Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
    )
    for (const [integrationID, compatibility] of legacyCompatibility) {
      const current = [...legacyCredentials.values()].find((entry) => entry.ref.integrationID === integrationID)
      if (!current) continue
      const resolved =
        compatibility.authorizationOnly && (current.value.type === "oauth" || current.value.key)
          ? { ...compatibility, authorizationOnly: undefined }
          : compatibility
      legacyCredentials.set(current.ref.id, {
        ...current,
        value: Credential.withCompatibility(current.value, resolved),
      })
    }
    // Apply general settings first and more specific settings last:
    // OpenCode config is a compatibility fallback; Hena documents are merged later and win.
    const configs = [
      ...legacySupplementary.flat(),
      ...legacyDirect,
      ...(supplementary[0] ?? []),
      ...direct,
      ...supplementary.slice(1).flat(),
    ]
    // Rules use the opposite order so a user-global rule can override a
    // repository rule. Statement order inside each file stays unchanged.
    yield* policy.load(
      configs
        .filter((config): config is Document => config.type === "document")
        .toReversed()
        .flatMap((config) => config.info.experimental?.policies ?? []),
    )

    return Service.of({
      entries: Effect.fn("Config.entries")(function* () {
        return configs
      }),
      credential: {
        list: Effect.fn("Config.credential.list")(function* () {
          return Array.from(legacyCredentials.values(), (credential) => credential.ref)
        }),
        resolve: Effect.fn("Config.credential.resolve")(function* (id) {
          return legacyCredentials.get(id)?.value
        }),
      },
    })
  }),
)

export const locationLayer = layer.pipe(Layer.provideMerge(Policy.locationLayer))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Location.node, Policy.node],
})

const LegacyAuthValue = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("api"),
    key: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  }),
  Schema.Struct({
    type: Schema.Literal("oauth"),
    refresh: Schema.String,
    access: Schema.String,
    expires: NonNegativeInt,
    accountId: Schema.String.pipe(Schema.optional),
    enterpriseUrl: Schema.String.pipe(Schema.optional),
  }),
  Schema.Struct({ type: Schema.Literal("wellknown"), key: Schema.String, token: Schema.String }),
])

function migrateLegacy(info: Schema.Schema.Type<typeof ConfigV1.Info>) {
  const credentials = new Map<string, Credential.Value>()
  const compatibility = new Map<string, Credential.Compatibility>()
  const unsupported: string[] = []
  const provider = Object.fromEntries(
    Object.entries(info.provider ?? {}).flatMap(([providerID, item]) => {
      const options = { ...item.options }
      const apiKey = typeof options.apiKey === "string" ? options.apiKey : undefined
      const authToken = typeof options.authToken === "string" ? options.authToken : undefined
      const headers = stringRecord(options.headers)
      delete options.apiKey
      delete options.authToken
      delete options.headers

      const models = Object.fromEntries(
        Object.entries(item.models ?? {}).map(([modelID, model]) => {
          const modelOptions = { ...model.options }
          const modelApiKey = typeof modelOptions.apiKey === "string" ? modelOptions.apiKey : undefined
          const modelAuthToken = typeof modelOptions.authToken === "string" ? modelOptions.authToken : undefined
          const modelHeaders = { ...stringRecord(modelOptions.headers), ...model.headers }
          delete modelOptions.apiKey
          delete modelOptions.authToken
          delete modelOptions.headers
          return [
            modelID,
            {
              model: {
                ...model,
                options: modelOptions,
                headers: undefined,
              },
              request: {
                ...(modelApiKey ? { apiKey: modelApiKey } : {}),
                ...(modelAuthToken && !modelApiKey ? { authorizationOnly: true } : {}),
                ...(Object.keys(modelHeaders).length || modelAuthToken
                  ? {
                      headers: {
                        ...modelHeaders,
                        ...(modelAuthToken ? { Authorization: `Bearer ${modelAuthToken}` } : {}),
                      },
                    }
                  : {}),
              },
            },
          ]
        }),
      )
      const sanitized = {
        ...item,
        options,
        models: Object.fromEntries(Object.entries(models).map(([id, x]) => [id, x.model])),
      }
      if (containsSecret(sanitized)) {
        unsupported.push(providerID)
        return []
      }

      const modelRequests = Object.fromEntries(
        Object.entries(models).flatMap(([id, model]) =>
          Object.keys(model.request).length ? [[id, model.request]] : [],
        ),
      )
      const request: Credential.Compatibility = {
        ...(Object.keys(headers).length || authToken
          ? { headers: { ...headers, ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) } }
          : {}),
        ...(authToken && !apiKey ? { authorizationOnly: true } : {}),
        ...(!apiKey && !authToken && (Object.keys(headers).length || Object.keys(modelRequests).length)
          ? { authorizationOnly: true }
          : {}),
        ...(Object.keys(modelRequests).length ? { models: modelRequests } : {}),
      }
      const hasPrivateCredential =
        apiKey ||
        authToken ||
        Object.keys(headers).length ||
        Object.values(modelRequests).some((model) => model.apiKey || Object.keys(model.headers ?? {}).length)
      if (hasPrivateCredential) {
        credentials.set(providerID, Credential.Key.make({ type: "key", key: apiKey ?? "" }))
        compatibility.set(providerID, request)
      }
      return [[providerID, sanitized]]
    }),
  )
  return { info: ConfigMigrateV1.migrate({ ...info, provider }), credentials, compatibility, unsupported }
}

function mergeCompatibility(current: Credential.Compatibility | undefined, next: Credential.Compatibility) {
  return {
    ...current,
    ...next,
    headers: { ...current?.headers, ...next.headers },
    models: { ...current?.models, ...next.models },
  }
}

function stringRecord(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function containsSecret(input: unknown): boolean {
  if (Array.isArray(input)) return input.some(containsSecret)
  if (typeof input !== "object" || input === null) return false
  return Object.entries(input).some(([key, value]) => secretKey(key) || containsSecret(value))
}

function secretKey(key: string) {
  return /api.?key|auth.?token|access.?token|refresh.?token|secret|password|authorization|cookie/i.test(key)
}
