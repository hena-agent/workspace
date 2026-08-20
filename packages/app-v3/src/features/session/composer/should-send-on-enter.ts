export type EnterKeyEvent = {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  nativeEvent: {
    isComposing: boolean
    keyCode?: number
  }
}

/** Composer Enter policy (spec §8.3). Mod+Enter always sends. Otherwise,
 * Shift+Enter is always a newline, and plain Enter only sends when a fine
 * pointer is present — a coarse-only device treats it as a newline so the
 * on-screen keyboard's Return key can't half-send a draft. */
export function shouldSendOnEnter(event: EnterKeyEvent, hasFinePointer: boolean): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return false
  if (event.metaKey || event.ctrlKey) return true
  if (event.shiftKey) return false
  return hasFinePointer
}
