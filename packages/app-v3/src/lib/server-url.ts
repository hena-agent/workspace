export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return

  const value = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (!URL.canParse(value)) return

  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  if (url.username || url.password || url.search || url.hash) return

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  return `${url.origin}${path}`
}

export function encodeServerSlug(url: string) {
  const bytes = new TextEncoder().encode(url)
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function decodeServerSlug(slug: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(slug) || slug.length % 4 === 1) return

  const encoded = slug.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(slug.length / 4) * 4, "=")
  const binary = atob(encoded)
  const decoded = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
  const normalized = normalizeServerUrl(decoded)
  if (!normalized || encodeServerSlug(normalized) !== slug) return
  return normalized
}
