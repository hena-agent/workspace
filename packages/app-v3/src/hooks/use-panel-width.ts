import { useState, useSyncExternalStore } from "react"

export const PANEL_MIN = 180

function panelMaxWidth() {
  return Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.3))
}

export function usePanelWidth(initialWidth: number) {
  const [store] = useState(() => {
    const listeners = new Set<() => void>()
    const max = panelMaxWidth()
    let snapshot = { max, width: Math.min(initialWidth, max) }
    const serverSnapshot = { max: PANEL_MIN, width: PANEL_MIN }

    function publish(width: number, nextMax: number) {
      if (snapshot.width === width && snapshot.max === nextMax) return
      snapshot = { max: nextMax, width }
      listeners.forEach((listener) => listener())
    }

    function resize() {
      const nextMax = panelMaxWidth()
      publish(Math.min(snapshot.width, nextMax), nextMax)
    }

    return {
      getSnapshot: () => snapshot,
      getServerSnapshot: () => serverSnapshot,
      setWidth(width: number | ((current: number) => number)) {
        const nextWidth = typeof width === "function" ? width(snapshot.width) : width
        publish(Math.max(PANEL_MIN, Math.min(snapshot.max, nextWidth)), snapshot.max)
      },
      subscribe(listener: () => void) {
        listeners.add(listener)
        if (listeners.size === 1) window.addEventListener("resize", resize)
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) window.removeEventListener("resize", resize)
        }
      },
    }
  })
  const panel = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  return [panel.width, panel.max, store.setWidth] as const
}
