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

/** Composer Enter policy (spec §8.3). Modified Enter always acts regardless
 * of pointer class, while plain Enter only sends when a fine pointer exists. */
export function getComposerEnterAction(
  event: EnterKeyEvent,
  hasFinePointer: boolean,
): "send" | "queue" | undefined {
  if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return undefined
  if (event.metaKey || event.ctrlKey) return event.shiftKey ? "queue" : "send"
  if (event.shiftKey) return undefined
  return hasFinePointer ? "send" : undefined
}
