export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config, type RequestResult } from "./gen/client/types.gen.js"
import { HenaClient, type Options } from "./gen/sdk.gen.js"
import { wrapClientError } from "./error-interceptor.js"
import type { AuthRefreshData, AuthRefreshResponses } from "./v2/gen/types.gen.js"
export { type Config as HenaClientConfig, HenaClient }
export type { AuthRefreshData, AuthRefreshResponses } from "./v2/gen/types.gen.js"

export type AuthRefresh = <ThrowOnError extends boolean = false>(
  options: Options<AuthRefreshData, ThrowOnError>,
) => RequestResult<AuthRefreshResponses, unknown, ThrowOnError>

export type HenaClientWithAuthRefresh = HenaClient & {
  auth: HenaClient["auth"] & { refresh: AuthRefresh }
}

function pick(value: string | null, fallback?: string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (value === encodeURIComponent(fallback)) return fallback
  return value
}

function rewrite(request: Request, directory?: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const value = pick(request.headers.get("x-hena-directory"), directory)
  if (!value) return request

  const url = new URL(request.url)
  if (!url.searchParams.has("directory")) {
    url.searchParams.set("directory", value)
  }

  const next = new Request(url, request)
  next.headers.delete("x-hena-directory")
  return next
}

export function createHenaClient(config?: Config & { directory?: string }): HenaClientWithAuthRefresh {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-hena-directory": encodeURIComponent(config.directory),
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) => rewrite(request, config?.directory))
  client.interceptors.error.use(wrapClientError)
  const sdk = new HenaClient({ client })
  const refresh = <ThrowOnError extends boolean = false>(options: Options<AuthRefreshData, ThrowOnError>) =>
    (options.client ?? client).post<AuthRefreshResponses, unknown, ThrowOnError>({
      url: "/auth/{providerID}/refresh",
      ...options,
    })
  return Object.assign(sdk, { auth: Object.assign(sdk.auth, { refresh }) })
}
