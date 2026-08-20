/** Deterministically stubs `window.matchMedia` for tests that render
 * breakpoint-driven components (see `useMediaQuery`). Call the returned
 * `change` function inside `act()` to simulate a viewport crossing the
 * query's threshold. */
export function mockMatchMedia(initialMatches: boolean) {
  const mediaQueryLists = new Set<TestMediaQueryList>()
  let matches = initialMatches

  class TestMediaQueryList extends EventTarget implements MediaQueryList {
    onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => void) | null = null
    readonly media: string
    private readonly legacyListeners = new Set<(this: MediaQueryList, event: MediaQueryListEvent) => void>()

    constructor(query: string) {
      super()
      this.media = query
    }

    get matches() {
      return matches
    }

    addListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => void) | null) {
      if (listener) this.legacyListeners.add(listener)
    }

    removeListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => void) | null) {
      if (listener) this.legacyListeners.delete(listener)
    }

    change(next: boolean) {
      const event = new MediaQueryListEvent("change", { matches: next, media: this.media })
      this.dispatchEvent(event)
      this.onchange?.call(this, event)
      for (const listener of this.legacyListeners) listener.call(this, event)
    }
  }

  window.matchMedia = (query) => {
    const mediaQueryList = new TestMediaQueryList(query)
    mediaQueryLists.add(mediaQueryList)
    return mediaQueryList
  }

  return {
    change(next: boolean) {
      matches = next
      for (const mediaQueryList of mediaQueryLists) mediaQueryList.change(next)
    },
  }
}
