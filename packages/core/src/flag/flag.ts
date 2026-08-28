import { Config } from "effect"

export function truthy(key: string) {
  const value = environment(key)?.toLowerCase()
  return value === "true" || value === "1"
}

export function environment(key: string) {
  return process.env[key]
}

const copy = environment("HENA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = environment("HENA_DISABLE_FFF")

function enabledByExperimental(key: string) {
  return environment(key) === undefined ? truthy("HENA_EXPERIMENTAL") : truthy(key)
}

function booleanConfig(key: string) {
  return Config.boolean(key).pipe(Config.withDefault(false))
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  HENA_AUTO_HEAP_SNAPSHOT: truthy("HENA_AUTO_HEAP_SNAPSHOT"),
  HENA_GIT_BASH_PATH: environment("HENA_GIT_BASH_PATH"),
  HENA_CONFIG: environment("HENA_CONFIG"),
  HENA_CONFIG_CONTENT: environment("HENA_CONFIG_CONTENT"),
  HENA_DISABLE_AUTOUPDATE: truthy("HENA_DISABLE_AUTOUPDATE"),
  HENA_ALWAYS_NOTIFY_UPDATE: truthy("HENA_ALWAYS_NOTIFY_UPDATE"),
  HENA_DISABLE_PRUNE: truthy("HENA_DISABLE_PRUNE"),
  HENA_DISABLE_TERMINAL_TITLE: truthy("HENA_DISABLE_TERMINAL_TITLE"),
  HENA_SHOW_TTFD: truthy("HENA_SHOW_TTFD"),
  HENA_DISABLE_AUTOCOMPACT: truthy("HENA_DISABLE_AUTOCOMPACT"),
  HENA_DISABLE_MODELS_FETCH: truthy("HENA_DISABLE_MODELS_FETCH"),
  HENA_DISABLE_MOUSE: truthy("HENA_DISABLE_MOUSE"),
  HENA_FAKE_VCS: environment("HENA_FAKE_VCS"),
  HENA_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("HENA_DISABLE_FFF"),
  HENA_SERVER_PASSWORD: environment("HENA_SERVER_PASSWORD"),
  HENA_SERVER_USERNAME: environment("HENA_SERVER_USERNAME"),

  // Experimental
  HENA_EXPERIMENTAL_FILEWATCHER: booleanConfig("HENA_EXPERIMENTAL_FILEWATCHER"),
  HENA_EXPERIMENTAL_DISABLE_FILEWATCHER: booleanConfig("HENA_EXPERIMENTAL_DISABLE_FILEWATCHER"),
  HENA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("HENA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  HENA_MODELS_URL: environment("HENA_MODELS_URL"),
  HENA_MODELS_PATH: environment("HENA_MODELS_PATH"),
  HENA_DB: environment("HENA_DB"),
  HENA_DISABLE_CHANNEL_DB: truthy("HENA_DISABLE_CHANNEL_DB"),

  HENA_WORKSPACE_ID: environment("HENA_WORKSPACE_ID"),
  HENA_EXPERIMENTAL_WORKSPACES: enabledByExperimental("HENA_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get HENA_DISABLE_PROJECT_CONFIG() {
    return truthy("HENA_DISABLE_PROJECT_CONFIG")
  },
  get HENA_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("HENA_EXPERIMENTAL_REFERENCES")
  },
  get HENA_CONFIG_DIR() {
    return environment("HENA_CONFIG_DIR")
  },
  get HENA_PURE() {
    return truthy("HENA_PURE")
  },
  get HENA_PERMISSION() {
    return environment("HENA_PERMISSION")
  },
  get HENA_PLUGIN_META_FILE() {
    return environment("HENA_PLUGIN_META_FILE")
  },
  get HENA_CLIENT() {
    return environment("HENA_CLIENT") ?? "cli"
  },
  get HENA_TEST_HOME() {
    return environment("HENA_TEST_HOME")
  },
  get HENA_REPO_CLONE_GITHUB_BASE_URL() {
    return environment("HENA_REPO_CLONE_GITHUB_BASE_URL")
  },
  get HENA_WEBSEARCH_PROVIDER() {
    return environment("HENA_WEBSEARCH_PROVIDER")
  },
  get HENA_LOG_LEVEL() {
    return environment("HENA_LOG_LEVEL")
  },
  get HENA_PRINT_LOGS() {
    return truthy("HENA_PRINT_LOGS")
  },
}
