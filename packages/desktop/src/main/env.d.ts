interface ImportMetaEnv {
  readonly HENA_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:hena-server" {
  export namespace Server {
    export const listen: typeof import("../../../hena/dist/types/src/node").Server.listen
    export type Listener = import("../../../hena/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../hena/dist/types/src/node").Config.get
    export type Info = import("../../../hena/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../hena/dist/types/src/node").bootstrap
}
