import { describe, expect, test } from "bun:test"
import { shouldSendOnEnter } from "./should-send-on-enter"

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

describe("shouldSendOnEnter", () => {
  test("ignores any key other than Enter", () => {
    expect(shouldSendOnEnter(key({ key: "a" }), true)).toBe(false)
  })

  test("does not send while an IME composition owns Enter", () => {
    expect(shouldSendOnEnter(key({ nativeEvent: { isComposing: true } }), true)).toBe(false)
    expect(shouldSendOnEnter(key({ metaKey: true, nativeEvent: { isComposing: true } }), true)).toBe(false)
    expect(shouldSendOnEnter(key({ nativeEvent: { isComposing: false, keyCode: 229 } }), true)).toBe(false)
  })

  describe("with a fine pointer (keyboard-first)", () => {
    test("plain Enter sends", () => {
      expect(shouldSendOnEnter(key({}), true)).toBe(true)
    })

    test("Shift+Enter inserts a newline", () => {
      expect(shouldSendOnEnter(key({ shiftKey: true }), true)).toBe(false)
    })

    test("Mod+Enter sends", () => {
      expect(shouldSendOnEnter(key({ metaKey: true }), true)).toBe(true)
    })
  })

  describe("coarse-only (phone/tablet, no keyboard)", () => {
    test("plain Enter inserts a newline", () => {
      expect(shouldSendOnEnter(key({}), false)).toBe(false)
    })

    test("Shift+Enter inserts a newline", () => {
      expect(shouldSendOnEnter(key({ shiftKey: true }), false)).toBe(false)
    })

    test("Mod+Enter always sends, regardless of pointer class", () => {
      expect(shouldSendOnEnter(key({ metaKey: true }), false)).toBe(true)
      expect(shouldSendOnEnter(key({ ctrlKey: true }), false)).toBe(true)
    })
  })
})
