import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __HENA__?: {
      deepLinks?: string[]
    }
  }
}
