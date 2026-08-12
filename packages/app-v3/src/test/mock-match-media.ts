/** Deterministically stubs `window.matchMedia` for tests that render
 * breakpoint-driven components (see `useMediaQuery`). Call the returned
 * `change` function inside `act()` to simulate a viewport crossing the
 * query's threshold. */
export function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  let matches = initialMatches

  // Only the members useMediaQuery actually calls are implemented; asserting
  // through `unknown` is the standard way to build a partial native-API stub
  // without a full implementation of the real MediaQueryList interface.
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      get matches() {
        return matches
      },
      addEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => {
        listeners.add(callback)
      },
      removeEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => {
        listeners.delete(callback)
      },
    }) as unknown as MediaQueryList) as typeof window.matchMedia

  return {
    change(next: boolean) {
      matches = next
      // Same rationale: a real MediaQueryListEvent carries DOM Event members
      // this stub has no use for.
      for (const callback of listeners) callback({ matches: next } as MediaQueryListEvent)
    },
  }
}
