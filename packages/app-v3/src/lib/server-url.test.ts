import { describe, expect, test } from "bun:test"
import { decodeServerSlug, encodeServerSlug, isServerUrlAllowed, normalizeServerUrl } from "./server-url"

describe("server URL slugs", () => {
  test("normalizes a server URL before encoding it", () => {
    expect(normalizeServerUrl(" HTTPS://Server.Example.com:443/hena/ ")).toBe("https://server.example.com/hena")
  })

  test("adds HTTPS when the scheme is omitted", () => {
    expect(normalizeServerUrl("server.example.com")).toBe("https://server.example.com")
  })

  test("round-trips an unpadded base64url slug", () => {
    const url = "https://server.example.com/hena"
    const slug = encodeServerSlug(url)

    expect(slug).not.toMatch(/[+/=]/)
    expect(decodeServerSlug(slug)).toBe(url)
  })

  test("rejects non-canonical and credential-bearing values", () => {
    expect(decodeServerSlug(encodeServerSlug("https://SERVER.example.com/"))).toBeUndefined()
    expect(normalizeServerUrl("https://user:secret@server.example.com")).toBeUndefined()
  })

  test("rejects explicit non-HTTP schemes", () => {
    expect(normalizeServerUrl("ftp://server.example.com")).toBeUndefined()
    expect(normalizeServerUrl("ws://server.example.com")).toBeUndefined()
    expect(normalizeServerUrl("file:///tmp/server.sock")).toBeUndefined()
    expect(normalizeServerUrl("mailto:admin@server.example.com")).toBeUndefined()
    expect(normalizeServerUrl("http:server.example.com")).toBeUndefined()
    expect(normalizeServerUrl("localhost:4096")).toBe("https://localhost:4096")
  })

  test("rejects server URLs and slugs beyond the supported route length", () => {
    expect(normalizeServerUrl(`https://server.example.com/${"a".repeat(2048)}`)).toBeUndefined()
    expect(decodeServerSlug("a".repeat(3000))).toBeUndefined()
  })

  test("applies transport rules for hosted and embedded origins", () => {
    expect(isServerUrlAllowed("https://server.example.com", "https://app.hena.dev")).toBe(true)
    expect(isServerUrlAllowed("http://localhost:4096", "https://app.hena.dev")).toBe(false)
    expect(isServerUrlAllowed("http://127.0.0.1:4096", "http://server.local:4096")).toBe(true)
    expect(isServerUrlAllowed("http://server.local:4096", "http://server.local:4096")).toBe(true)
    expect(isServerUrlAllowed("http://other.local:4096", "http://server.local:4096")).toBe(false)
  })
})
