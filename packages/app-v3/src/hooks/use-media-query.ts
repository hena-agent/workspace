import { useSyncExternalStore } from "react"

// Server/first-paint snapshot is always `false` (mobile-first): the shell
// renders the mobile layout until the real match is known, never a desktop
// layout that would have to be torn down immediately after hydration.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mediaQueryList = window.matchMedia(query)
      mediaQueryList.addEventListener("change", onChange)
      return () => mediaQueryList.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
