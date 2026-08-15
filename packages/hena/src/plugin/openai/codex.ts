import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { InstallationVersion } from "@hena/core/installation/version"
import { Flock } from "@hena/core/util/flock"
import { isEnvironmentBacked, OAUTH_DUMMY_KEY } from "../../auth"
import os from "os"
import { setTimeout as sleep } from "node:timers/promises"
import { createServer } from "http"
import { OpenAIWebSocketPool } from "./ws-pool"
import { OauthCallbackPage } from "@hena/core/oauth/page"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_PORT = 1455
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
export const OPENAI_OAUTH_REFRESH_WINDOW_MS = 5 * 60_000
const OPENAI_OAUTH_REFRESH_TIMEOUT_MS = 30_000
const OPENAI_OAUTH_REFRESH_LOCK = "openai-oauth-refresh"
const ALLOWED_MODELS = new Set(["gpt-5.5", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini"])
const DISALLOWED_MODELS = new Set(["gpt-5.5-pro"])

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)))
    .map((b) => chars[b % chars.length])
    .join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export interface IdTokenClaims {
  chatgpt_account_id?: string
  chatgpt_account_is_fedramp?: boolean
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
    chatgpt_account_is_fedramp?: boolean
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractAccountId<
  T extends Pick<TokenResponse, "access_token"> & Partial<Pick<TokenResponse, "id_token">>,
>(tokens: T): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims ? extractAccountIdFromClaims(claims) : undefined
  }
  return undefined
}

function tokenFedramp(token?: string) {
  if (!token) return undefined
  const claims = parseJwtClaims(token)
  const value =
    claims?.chatgpt_account_is_fedramp ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_is_fedramp
  return typeof value === "boolean" ? value : undefined
}

function extractFedramp<T extends Pick<TokenResponse, "access_token"> & Partial<Pick<TokenResponse, "id_token">>>(
  tokens: T,
) {
  return tokenFedramp(tokens.id_token) ?? tokenFedramp(tokens.access_token)
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    // OpenAI registers this OAuth originator independently of product branding.
    originator: "opencode",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type RefreshTokenResponse = Omit<TokenResponse, "id_token" | "refresh_token"> & {
  id_token?: string
  refresh_token?: string
}

interface CodexAuthPluginOptions {
  issuer?: string
  codexApiEndpoint?: string
  experimentalWebSockets?: boolean
}

async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return response.json()
}

async function refreshAccessToken(
  refreshToken: string,
  issuer = ISSUER,
  signal?: AbortSignal,
): Promise<RefreshTokenResponse> {
  const response = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }
  return response.json()
}

export type OpenAIOAuth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
  fedramp?: boolean
}

export type RefreshedOpenAIAuth = OpenAIOAuth & { fedramp: boolean }

export function refreshOpenAIAuth(input: {
  getAuth: () => Promise<OpenAIOAuth>
  setAuth: (expected: OpenAIOAuth, auth: OpenAIOAuth) => Promise<boolean>
  issuer?: string
  minimumValidityMs?: number
  environmentBacked?: boolean
  signal?: AbortSignal
}) {
  if (input.environmentBacked ?? isEnvironmentBacked()) {
    return Promise.reject(new Error("Environment-backed OpenAI OAuth authentication cannot be refreshed durably"))
  }

  return Flock.withLock(
    OPENAI_OAUTH_REFRESH_LOCK,
    async () => {
      const current = await input.getAuth()
      if (current.access && current.expires > Date.now() + (input.minimumValidityMs ?? 0)) {
        return { ...current, fedramp: current.fedramp ?? tokenFedramp(current.access) ?? false }
      }

      const tokens = await refreshAccessToken(current.refresh, input.issuer, input.signal)
      const accountId = extractAccountId(tokens) || current.accountId
      const fedramp = extractFedramp(tokens) ?? current.fedramp ?? false
      const next: OpenAIOAuth = {
        ...current,
        access: tokens.access_token,
        refresh: tokens.refresh_token ?? current.refresh,
        expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        ...(accountId ? { accountId } : {}),
        fedramp,
      }
      if (await input.setAuth(current, next)) return { ...next, fedramp }

      const latest = await input.getAuth()
      if (latest.access && latest.expires > Date.now() + (input.minimumValidityMs ?? 0)) {
        return { ...latest, fedramp: latest.fedramp ?? tokenFedramp(latest.access) ?? false }
      }
      throw new Error("OpenAI OAuth authentication changed while it was being refreshed")
    },
    { signal: input.signal },
  )
}

function waitForOpenAIAuth(refresh: Promise<OpenAIOAuth>, signal?: AbortSignal) {
  if (!signal) return refresh
  if (signal.aborted) {
    void refresh.catch(() => undefined)
    return Promise.reject(signal.reason)
  }

  return new Promise<OpenAIOAuth>((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    signal.addEventListener("abort", cancel, { once: true })
    refresh.then(
      (auth) => {
        signal.removeEventListener("abort", cancel)
        resolve(auth)
      },
      (error) => {
        signal.removeEventListener("abort", cancel)
        reject(error)
      },
    )
  })
}

// Kept as a named export for plugin.codex tests; delegates to the shared branded page.
export const renderOAuthError = (error: string) => OauthCallbackPage.error(error, { provider: "ChatGPT" })

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) {
    return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
  }

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`)

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const errorMsg = errorDescription || error
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderOAuthError(errorMsg))
        return
      }

      if (!code) {
        const errorMsg = "Missing authorization code"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderOAuthError(errorMsg))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        const errorMsg = "Invalid state - potential CSRF attack"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderOAuthError(errorMsg))
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined

      exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(OauthCallbackPage.success({ provider: "ChatGPT" }))
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  await new Promise<void>((resolve, reject) => {
    oauthServer!.listen(OAUTH_PORT, () => {
      resolve()
    })
    oauthServer!.on("error", reject)
  })

  return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.close(() => {})
    oauthServer = undefined
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    ) // 5 minute timeout

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

export async function CodexAuthPlugin(input: PluginInput, options: CodexAuthPluginOptions = {}): Promise<Hooks> {
  const issuer = options.issuer ?? ISSUER
  const codexApiEndpoint = options.codexApiEndpoint ?? CODEX_API_ENDPOINT
  let websocketFetchInstalled = false
  const websocketFetches: Array<ReturnType<typeof OpenAIWebSocketPool.createWebSocketFetch>> = []

  return {
    async dispose() {
      for (const websocketFetch of websocketFetches) websocketFetch.close()
      websocketFetches.length = 0
    },
    async event(input) {
      if (input.event.type !== "session.deleted") return
      for (const websocketFetch of websocketFetches) websocketFetch.remove(input.event.properties.info.id)
    },
    provider: {
      id: "openai",
      async models(provider, ctx) {
        if (ctx.auth?.type !== "oauth") return provider.models

        return Object.fromEntries(
          Object.entries(provider.models)
            .filter(([, model]) => {
              if (model.options.reasoningMode === "pro") return false
              if (ALLOWED_MODELS.has(model.api.id)) return true
              if (DISALLOWED_MODELS.has(model.api.id)) return false
              if (model.api.id === "gpt-5.6") return false
              const match = model.api.id.match(/^gpt-(\d+\.\d+)/)
              return match ? parseFloat(match[1]) > 5.4 : false
            })
            .map(([modelID, model]) => [
              modelID,
              {
                ...model,
                cost: {
                  input: 0,
                  output: 0,
                  cache: { read: 0, write: 0 },
                },
                limit: model.id.includes("gpt-5.5")
                  ? {
                      context: 400_000,
                      input: 272_000,
                      output: 128_000,
                    }
                  : model.id.includes("gpt-5.6")
                    ? {
                        context: 500_000,
                        input: 372_000,
                        output: 128_000,
                      }
                    : model.limit,
              },
            ]),
        )
      },
    },
    auth: {
      provider: "openai",
      async loader(getAuth) {
        const auth = await getAuth()
        const websocketFetch = options.experimentalWebSockets
          ? OpenAIWebSocketPool.createWebSocketFetch({ httpFetch: fetch })
          : undefined
        if (websocketFetch) {
          websocketFetches.push(websocketFetch)
          websocketFetchInstalled = true
        }
        if (auth.type !== "oauth") return websocketFetch ? { fetch: websocketFetch } : {}

        let refreshPromise: Promise<OpenAIOAuth> | undefined

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.delete("authorization")
                init.headers.delete("Authorization")
              } else if (Array.isArray(init.headers)) {
                init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization")
              } else {
                delete init.headers["authorization"]
                delete init.headers["Authorization"]
              }
            }

            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth")
              return websocketFetch ? websocketFetch(requestInput, init) : fetch(requestInput, init)

            const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }

            if (!currentAuth.access || currentAuth.expires < Date.now()) {
              init?.signal?.throwIfAborted()
              const refreshing =
                refreshPromise ??
                input.client.auth
                  .refresh({
                    path: { providerID: "openai" },
                    signal: AbortSignal.timeout(OPENAI_OAUTH_REFRESH_TIMEOUT_MS),
                    throwOnError: true,
                  })
                  .then((response) => ({
                    type: "oauth" as const,
                    refresh: currentAuth.refresh,
                    access: response.data.access,
                    expires: response.data.expires,
                    ...(response.data.accountId ? { accountId: response.data.accountId } : {}),
                    fedramp: response.data.fedramp,
                  }))
                  .finally(() => {
                    refreshPromise = undefined
                  })
              refreshPromise = refreshing
              const refreshed = await waitForOpenAIAuth(refreshing, init?.signal ?? undefined)
              currentAuth.access = refreshed.access
              authWithAccount.accountId = refreshed.accountId
            }

            const headers = new Headers()
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => headers.set(key, value))
              } else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              } else {
                for (const [key, value] of Object.entries(init.headers)) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              }
            }
            headers.set("authorization", `Bearer ${currentAuth.access}`)
            if (authWithAccount.accountId) {
              headers.set("ChatGPT-Account-Id", authWithAccount.accountId)
            }

            const parsed =
              requestInput instanceof URL
                ? requestInput
                : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
            const url =
              parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
                ? new URL(codexApiEndpoint)
                : parsed

            const requestInit = {
              ...init,
              body: init?.body,
              headers,
            }
            if (websocketFetch && parsed.pathname.endsWith("/responses")) return websocketFetch(url, requestInit)
            return fetch(url, OpenAIWebSocketPool.withoutInternalHeaders(requestInit))
          },
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: async () => {
            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
            const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)

            const callbackPromise = waitForOAuthCallback(pkce, state)

            return {
              url: authUrl,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                const tokens = await callbackPromise
                stopOAuthServer()
                const accountId = extractAccountId(tokens)
                const fedramp = extractFedramp(tokens)
                return {
                  type: "success" as const,
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  accountId,
                  ...(fedramp !== undefined ? { fedramp } : {}),
                }
              },
            }
          },
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: async () => {
            const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": `hena/${InstallationVersion}`,
              },
              body: JSON.stringify({ client_id: CLIENT_ID }),
            })

            if (!deviceResponse.ok) throw new Error("Failed to initiate device authorization")

            const deviceData = (await deviceResponse.json()) as {
              device_auth_id: string
              user_code: string
              interval: string
            }
            const interval = Math.max(parseInt(deviceData.interval) || 5, 1) * 1000

            return {
              url: `${ISSUER}/codex/device`,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "User-Agent": `hena/${InstallationVersion}`,
                    },
                    body: JSON.stringify({
                      device_auth_id: deviceData.device_auth_id,
                      user_code: deviceData.user_code,
                    }),
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      authorization_code: string
                      code_verifier: string
                    }

                    const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: data.authorization_code,
                        redirect_uri: `${ISSUER}/deviceauth/callback`,
                        client_id: CLIENT_ID,
                        code_verifier: data.code_verifier,
                      }).toString(),
                    })

                    if (!tokenResponse.ok) {
                      throw new Error(`Token exchange failed: ${tokenResponse.status}`)
                    }

                    const tokens: TokenResponse = await tokenResponse.json()
                    const fedramp = extractFedramp(tokens)

                    return {
                      type: "success" as const,
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractAccountId(tokens),
                      ...(fedramp !== undefined ? { fedramp } : {}),
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    return { type: "failed" as const }
                  }

                  await sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
    "chat.headers": async (input, output) => {
      if (input.model.providerID !== "openai") return
      output.headers.originator = "opencode"
      output.headers["User-Agent"] = `hena/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`
      output.headers["session-id"] = input.sessionID
      // Temporary fetch-layer hack: title generation currently shares the conversation
      // session ID, so the OpenAI plugin marks it for HTTP fallback until transport
      // context can be passed directly instead of smuggled through headers.
      if (websocketFetchInstalled && input.agent === "title") output.headers[OpenAIWebSocketPool.TITLE_HEADER] = "true"
    },
    "chat.params": async (input, output) => {
      if (input.model.providerID !== "openai") return
      // Match codex cli
      output.maxOutputTokens = undefined
    },
  }
}
