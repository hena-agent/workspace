const MAX_SERVER_URL_LENGTH = 2048
const MAX_SERVER_SLUG_LENGTH = Math.ceil((MAX_SERVER_URL_LENGTH * 4) / 3)

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > MAX_SERVER_URL_LENGTH) return
  const scheme = trimmed.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase()
  const hostWithPort = /^[^/?#]+:\d+(?:\/|$)/.test(trimmed)
  if (scheme && !hostWithPort && !/^https?:\/\//i.test(trimmed)) return

  const value = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (!URL.canParse(value)) return

  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  if (url.username || url.password || url.search || url.hash) return

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  const normalized = `${url.origin}${path}`
  if (normalized.length > MAX_SERVER_URL_LENGTH) return
  return normalized
}

export function isServerUrlAllowed(url: string, pageOrigin: string) {
  if (!URL.canParse(url)) return false
  const target = new URL(url)
  if (target.protocol === "https:") return true

  if (!URL.canParse(pageOrigin)) return false
  const page = new URL(pageOrigin)
  if (page.protocol !== "http:") return false
  if (target.origin === page.origin) return true

  const hostname = target.hostname.replace(/^\[|\]$/g, "")
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  )
}

export function encodeServerSlug(url: string) {
  const bytes = new TextEncoder().encode(url)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function decodeServerSlug(slug: string) {
  if (slug.length > MAX_SERVER_SLUG_LENGTH || !/^[A-Za-z0-9_-]+$/.test(slug) || slug.length % 4 === 1) return

  const encoded = slug.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(slug.length / 4) * 4, "=")
  const binary = atob(encoded)
  const decoded = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
  const normalized = normalizeServerUrl(decoded)
  if (!normalized || encodeServerSlug(normalized) !== slug) return
  return normalized
}
