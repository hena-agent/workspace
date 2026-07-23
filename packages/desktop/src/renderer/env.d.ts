import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __HENA_AGENT__?: {
      deepLinks?: string[]
    }
  }
}
