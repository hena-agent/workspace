import { normalizeServerUrl } from "@/lib/server-url"
import type { Fetcher } from "./agent"

export type ProbeStatus =
  | "reachable"
  | "auth-unsupported"
  | "upgrade-required"
  | "cors"
  | "unreachable"
  | "transport-blocked"
  | "invalid"

export type ProbeResult = {
  status: ProbeStatus
  url?: string
  message: string
  feedId?: string
}

export async function probeServer(input: {
  url: string
  profileOrigin: string
  allowLoopbackHttp?: boolean
  fetcher?: Fetcher
}): Promise<ProbeResult> {
  const url = normalizeServerUrl(input.url)
  if (!url) return { status: "invalid", message: "Enter a valid HTTP or HTTPS server URL without credentials, a query, or a fragment." }

  const blocked = transportError(url, input.profileOrigin, Boolean(input.allowLoopbackHttp))
  if (blocked) return { status: "transport-blocked", url, message: blocked }

  const fetcher = input.fetcher ?? fetch
  const endpoint = `${url}/api/collection/capabilities`
  const response = await fetcher(endpoint, { cache: "no-store" }).catch(() => undefined)
  if (response) return diagnoseCapabilities(response, url)

  const opaque = await fetcher(endpoint, { cache: "no-store", mode: "no-cors" }).catch(() => undefined)
  if (opaque) {
    return {
      status: "cors",
      url,
      message: `The server is reachable but rejects this profile. Add ${webOrigin(input.profileOrigin)} to the server.cors configuration.`,
    }
  }
  return {
    status: "unreachable",
    url,
    message: "The server could not be reached. Open it in a new tab to check its address and certificate.",
  }
}

export function canRegisterProbe(result: ProbeResult) {
  return result.status === "reachable"
}

async function diagnoseCapabilities(response: Response, url: string): Promise<ProbeResult> {
  if (response.status === 401) {
    return {
      status: "auth-unsupported",
      url,
      message: "This build does not support password-protected servers yet.",
    }
  }
  if (!response.ok) {
    return {
      status: "upgrade-required",
      url,
      message: `The server is reachable but its capabilities endpoint returned HTTP ${response.status}. Upgrade the server or this app.`,
    }
  }
  const value = await response.json().catch(() => undefined)
  if (!isCapabilities(value)) {
    return {
      status: "upgrade-required",
      url,
      message: "The server is reachable but returned an unsupported capabilities response. Upgrade the server or this app.",
    }
  }
  if (value.auth === "required") {
    return {
      status: "auth-unsupported",
      url,
      message: "This build does not support password-protected servers yet.",
    }
  }
  if (value.protocol.min > 1 || value.protocol.max < 1) {
    return {
      status: "upgrade-required",
      url,
      message: `This app requires protocol 1, but the server supports ${value.protocol.min}-${value.protocol.max}. Upgrade the server or this app.`,
    }
  }
  return { status: "reachable", url, feedId: value.feedId, message: "Server reachable and compatible." }
}

function transportError(url: string, profileOrigin: string, allowLoopbackHttp: boolean) {
  const target = new URL(url)
  if (target.protocol === "https:") return
  const normalizedProfile = normalizeServerUrl(profileOrigin)
  if (!normalizedProfile) return
  const profile = new URL(normalizedProfile)
  if (target.origin === profile.origin) return
  if (allowLoopbackHttp && isLoopback(target.hostname)) return
  if (profile.protocol === "https:") return "This hosted profile accepts HTTPS servers only."
  return "Plain HTTP is allowed only for this profile's origin or a loopback server."
}

function webOrigin(value: string) {
  const normalized = normalizeServerUrl(value)
  return normalized ? new URL(normalized).origin : value
}

function isLoopback(hostname: string) {
  const value = hostname.replace(/^\[|\]$/g, "")
  return value === "localhost" || value.endsWith(".localhost") || value === "::1" || /^127(?:\.\d{1,3}){3}$/.test(value)
}

function isCapabilities(value: unknown): value is {
  feedId?: string
  auth: "none" | "required"
  protocol: { min: number; max: number }
} {
  return typeof value === "object" && value !== null && "auth" in value && (value.auth === "none" || value.auth === "required") &&
    "protocol" in value && typeof value.protocol === "object" && value.protocol !== null &&
    "min" in value.protocol && typeof value.protocol.min === "number" &&
    "max" in value.protocol && typeof value.protocol.max === "number" &&
    (!("feedId" in value) || typeof value.feedId === "string")
}
