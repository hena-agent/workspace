import { afterEach, describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"
import { mockMatchMedia } from "@/test/mock-match-media"
import { useMediaQuery } from "./use-media-query"

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe("useMediaQuery", () => {
  test("reflects the current match state", () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"))
    expect(result.current).toBe(true)
  })

  test("updates when the media query change event fires", () => {
    const control = mockMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"))
    expect(result.current).toBe(false)

    act(() => control.change(true))
    expect(result.current).toBe(true)
  })
})
