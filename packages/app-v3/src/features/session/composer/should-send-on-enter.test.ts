import { describe, expect, test } from "bun:test"
import { getComposerEnterAction } from "./should-send-on-enter"

const key = (
  overrides: Partial<{
    key: string
    shiftKey: boolean
    metaKey: boolean
    ctrlKey: boolean
    nativeEvent: { isComposing: boolean; keyCode?: number }
  }>,
) => ({
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  nativeEvent: { isComposing: false },
  ...overrides,
})

describe("getComposerEnterAction", () => {
  test("ignores any key other than Enter", () => {
    expect(getComposerEnterAction(key({ key: "a" }), true)).toBeUndefined()
  })

  test("does not send while an IME composition owns Enter", () => {
    expect(getComposerEnterAction(key({ nativeEvent: { isComposing: true } }), true)).toBeUndefined()
    expect(getComposerEnterAction(key({ metaKey: true, nativeEvent: { isComposing: true } }), true)).toBeUndefined()
    expect(getComposerEnterAction(key({ nativeEvent: { isComposing: false, keyCode: 229 } }), true)).toBeUndefined()
  })

  describe("with a fine pointer (keyboard-first)", () => {
    test("plain Enter sends", () => {
      expect(getComposerEnterAction(key({}), true)).toBe("send")
    })

    test("Shift+Enter inserts a newline", () => {
      expect(getComposerEnterAction(key({ shiftKey: true }), true)).toBeUndefined()
    })

    test("Mod+Enter sends", () => {
      expect(getComposerEnterAction(key({ metaKey: true }), true)).toBe("send")
    })

    test("Mod+Shift+Enter queues", () => {
      expect(getComposerEnterAction(key({ metaKey: true, shiftKey: true }), true)).toBe("queue")
    })
  })

  describe("coarse-only (phone/tablet, no keyboard)", () => {
    test("plain Enter inserts a newline", () => {
      expect(getComposerEnterAction(key({}), false)).toBeUndefined()
    })

    test("Shift+Enter inserts a newline", () => {
      expect(getComposerEnterAction(key({ shiftKey: true }), false)).toBeUndefined()
    })

    test("Mod+Enter always sends, regardless of pointer class", () => {
      expect(getComposerEnterAction(key({ metaKey: true }), false)).toBe("send")
      expect(getComposerEnterAction(key({ ctrlKey: true }), false)).toBe("send")
    })

    test("Mod+Shift+Enter always queues, regardless of pointer class", () => {
      expect(getComposerEnterAction(key({ ctrlKey: true, shiftKey: true }), false)).toBe("queue")
    })
  })
})
