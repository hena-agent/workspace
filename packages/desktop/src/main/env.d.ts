interface ImportMetaEnv {
  readonly HENA_AGENT_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:hena-agent-server" {
  export namespace Server {
    export const listen: typeof import("../../../hena-agent/dist/types/src/node").Server.listen
    export type Listener = import("../../../hena-agent/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../hena-agent/dist/types/src/node").Config.get
    export type Info = import("../../../hena-agent/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../hena-agent/dist/types/src/node").bootstrap
}
