import { Config } from "effect"

export function truthy(key: string) {
  const value = environment(key)?.toLowerCase()
  return value === "true" || value === "1"
}

export function environment(key: string) {
  return process.env[key]
}

const copy = environment("HENA_AGENT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = environment("HENA_AGENT_DISABLE_FFF")

function enabledByExperimental(key: string) {
  return environment(key) === undefined ? truthy("HENA_AGENT_EXPERIMENTAL") : truthy(key)
}

function booleanConfig(key: string) {
  return Config.boolean(key).pipe(Config.withDefault(false))
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  HENA_AGENT_AUTO_HEAP_SNAPSHOT: truthy("HENA_AGENT_AUTO_HEAP_SNAPSHOT"),
  HENA_AGENT_GIT_BASH_PATH: environment("HENA_AGENT_GIT_BASH_PATH"),
  HENA_AGENT_CONFIG: environment("HENA_AGENT_CONFIG"),
  HENA_AGENT_CONFIG_CONTENT: environment("HENA_AGENT_CONFIG_CONTENT"),
  HENA_AGENT_DISABLE_AUTOUPDATE: truthy("HENA_AGENT_DISABLE_AUTOUPDATE"),
  HENA_AGENT_ALWAYS_NOTIFY_UPDATE: truthy("HENA_AGENT_ALWAYS_NOTIFY_UPDATE"),
  HENA_AGENT_DISABLE_PRUNE: truthy("HENA_AGENT_DISABLE_PRUNE"),
  HENA_AGENT_DISABLE_TERMINAL_TITLE: truthy("HENA_AGENT_DISABLE_TERMINAL_TITLE"),
  HENA_AGENT_SHOW_TTFD: truthy("HENA_AGENT_SHOW_TTFD"),
  HENA_AGENT_DISABLE_AUTOCOMPACT: truthy("HENA_AGENT_DISABLE_AUTOCOMPACT"),
  HENA_AGENT_DISABLE_MODELS_FETCH: truthy("HENA_AGENT_DISABLE_MODELS_FETCH"),
  HENA_AGENT_DISABLE_MOUSE: truthy("HENA_AGENT_DISABLE_MOUSE"),
  HENA_AGENT_FAKE_VCS: environment("HENA_AGENT_FAKE_VCS"),
  HENA_AGENT_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("HENA_AGENT_DISABLE_FFF"),
  HENA_AGENT_SERVER_PASSWORD: environment("HENA_AGENT_SERVER_PASSWORD"),
  HENA_AGENT_SERVER_USERNAME: environment("HENA_AGENT_SERVER_USERNAME"),

  // Experimental
  HENA_AGENT_EXPERIMENTAL_FILEWATCHER: booleanConfig("HENA_AGENT_EXPERIMENTAL_FILEWATCHER"),
  HENA_AGENT_EXPERIMENTAL_DISABLE_FILEWATCHER: booleanConfig("HENA_AGENT_EXPERIMENTAL_DISABLE_FILEWATCHER"),
  HENA_AGENT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("HENA_AGENT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  HENA_AGENT_MODELS_URL: environment("HENA_AGENT_MODELS_URL"),
  HENA_AGENT_MODELS_PATH: environment("HENA_AGENT_MODELS_PATH"),
  HENA_AGENT_DB: environment("HENA_AGENT_DB"),
  HENA_AGENT_DISABLE_CHANNEL_DB: truthy("HENA_AGENT_DISABLE_CHANNEL_DB"),

  HENA_AGENT_WORKSPACE_ID: environment("HENA_AGENT_WORKSPACE_ID"),
  HENA_AGENT_EXPERIMENTAL_WORKSPACES: enabledByExperimental("HENA_AGENT_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get HENA_AGENT_DISABLE_PROJECT_CONFIG() {
    return truthy("HENA_AGENT_DISABLE_PROJECT_CONFIG")
  },
  get HENA_AGENT_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("HENA_AGENT_EXPERIMENTAL_REFERENCES")
  },
  get HENA_AGENT_TUI_CONFIG() {
    return environment("HENA_AGENT_TUI_CONFIG")
  },
  get HENA_AGENT_CONFIG_DIR() {
    return environment("HENA_AGENT_CONFIG_DIR")
  },
  get HENA_AGENT_PURE() {
    return truthy("HENA_AGENT_PURE")
  },
  get HENA_AGENT_PERMISSION() {
    return environment("HENA_AGENT_PERMISSION")
  },
  get HENA_AGENT_PLUGIN_META_FILE() {
    return environment("HENA_AGENT_PLUGIN_META_FILE")
  },
  get HENA_AGENT_CLIENT() {
    return environment("HENA_AGENT_CLIENT") ?? "cli"
  },
  get HENA_AGENT_TEST_HOME() {
    return environment("HENA_AGENT_TEST_HOME")
  },
  get HENA_AGENT_REPO_CLONE_GITHUB_BASE_URL() {
    return environment("HENA_AGENT_REPO_CLONE_GITHUB_BASE_URL")
  },
  get HENA_AGENT_WEBSEARCH_PROVIDER() {
    return environment("HENA_AGENT_WEBSEARCH_PROVIDER")
  },
  get HENA_AGENT_LOG_LEVEL() {
    return environment("HENA_AGENT_LOG_LEVEL")
  },
  get HENA_AGENT_PRINT_LOGS() {
    return truthy("HENA_AGENT_PRINT_LOGS")
  },
}
