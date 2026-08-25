import { beforeEach, describe, expect, test } from "bun:test"
import { createConnectionRegistry } from "./registry"

describe("connection registry", () => {
  beforeEach(() => localStorage.clear())

  test("persists canonical URL identity and clears tombstones on re-add", () => {
    const registry = createConnectionRegistry()
    expect(registry.add("HTTPS://EXAMPLE.COM:443/hena/")?.url).toBe("https://example.com/hena")
    expect(registry.add("https://example.com/hena")?.url).toBe("https://example.com/hena")
    expect(registry.list()).toHaveLength(1)

    registry.remove("https://example.com/hena")
    expect(registry.resolve("https://example.com/hena")).toBe("tombstoned")

    createConnectionRegistry().add("https://example.com/hena")
    expect(createConnectionRegistry().resolve("https://example.com/hena")).toBe("registered")
  })

  test("seeds and protects the embedded origin", () => {
    const registry = createConnectionRegistry({ ownUrl: "http://127.0.0.1:4106" })
    expect(registry.list()).toEqual([
      expect.objectContaining({ url: "http://127.0.0.1:4106", own: true }),
    ])
    expect(registry.remove("http://127.0.0.1:4106")).toBe(false)
  })
})
