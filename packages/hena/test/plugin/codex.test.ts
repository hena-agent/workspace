import { describe, expect, test } from "bun:test"
import {
  CodexAuthPlugin,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  refreshOpenAIAuth,
  renderOAuthError,
  type IdTokenClaims,
  type OpenAIOAuth,
} from "../../src/plugin/openai/codex"
import { Effect, Fiber } from "effect"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  test("escapes provider errors in callback HTML", () => {
    const error = `</div><script>alert("xss" & 'more')</script>`
    const html = renderOAuthError(error)

    expect(html).toContain("&lt;/div&gt;&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;more&#39;)&lt;/script&gt;")
    expect(html).not.toContain(error)
  })

  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  test("installs websocket transport only when experimental websockets are enabled", async () => {
    const disabled = await CodexAuthPlugin({} as never)
    const enabled = await CodexAuthPlugin({} as never, { experimentalWebSockets: true })

    const disabledOptions = await disabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )
    const enabledOptions = await enabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )

    expect(disabledOptions.fetch).toBeUndefined()
    expect(enabledOptions.fetch).toBeFunction()
    await enabled.dispose?.()
  })

  test("filters unsupported modes and uses Codex context limits for OAuth GPT models", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const limit = { context: 1_050_000, input: 922_000, output: 128_000 }
    const provider = {
      models: {
        ...Object.fromEntries(
          ["gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.7-pro"].map((id) => [
            id,
            { id, api: { id }, limit, cost: {}, options: {} },
          ]),
        ),
        "gpt-5.4-pro": {
          id: "gpt-5.4-pro",
          api: { id: "gpt-5.4" },
          limit,
          cost: {},
          options: { reasoningMode: "pro" },
        },
        "gpt-5.6-sol-high": {
          id: "gpt-5.6-sol-high",
          api: { id: "gpt-5.6-sol" },
          limit,
          cost: {},
          options: { reasoningEffort: "high" },
        },
      },
    }

    const models = await hooks.provider!.models!(provider as never, { auth: { type: "oauth" } } as never)

    expect(models["gpt-5.4"]?.limit).toEqual(limit)
    expect(models["gpt-5.5"]?.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(models["gpt-5.6-sol"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.6-terra"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.6-luna"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.4-pro"]).toBeUndefined()
    expect(models["gpt-5.7-pro"]).toBeDefined()
    expect(models["gpt-5.6-sol-high"]).toBeDefined()
    expect(await hooks.provider!.models!(provider as never, { auth: { type: "api" } } as never)).toBe(
      provider.models as never,
    )
  })

  test("serializes independent OpenAI token refreshes", async () => {
    let auth: OpenAIOAuth = {
      type: "oauth",
      refresh: "refresh-old",
      access: "access-old",
      expires: 0,
    }
    let updates = 0
    let refreshRequests = 0
    let resolveRefresh: (() => void) | undefined
    const refreshReady = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })

    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        expect(await request.text()).toContain("refresh_token=refresh-old")
        refreshRequests += 1
        await refreshReady
        return Response.json({
          id_token: createTestJwt({
            chatgpt_account_id: "acc-123",
            "https://api.openai.com/auth": { chatgpt_account_is_fedramp: true },
          }),
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
        })
      },
    })

    const input = {
      getAuth: async () => auth,
      setAuth: async (expected: OpenAIOAuth, next: OpenAIOAuth) => {
        if (auth.access !== expected.access || auth.refresh !== expected.refresh || auth.expires !== expected.expires) {
          return false
        }
        updates += 1
        auth = next
        return true
      },
      issuer: server.url.origin,
      minimumValidityMs: 5 * 60_000,
    }
    const first = refreshOpenAIAuth(input)
    await waitFor(() => refreshRequests === 1)
    const second = refreshOpenAIAuth(input)
    resolveRefresh!()

    const refreshed = await Promise.all([first, second])
    expect(refreshRequests).toBe(1)
    expect(updates).toBe(1)
    expect(refreshed.map((item) => item.access)).toEqual(["access-new", "access-new"])
    expect(refreshed.map((item) => item.refresh)).toEqual(["refresh-new", "refresh-new"])
    expect(refreshed.map((item) => item.fedramp)).toEqual([true, true])
  })

  test("continues OpenAI token refresh after caller cancellation", async () => {
    let auth: OpenAIOAuth = {
      type: "oauth",
      refresh: "refresh-old",
      access: "access-old",
      expires: 0,
    }
    let refreshRequests = 0
    let updates = 0
    let resolveRefresh: (() => void) | undefined
    const refreshReady = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })

    using server = Bun.serve({
      port: 0,
      async fetch() {
        refreshRequests += 1
        await refreshReady
        return Response.json({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
        })
      },
    })

    const fiber = Effect.runFork(
      Effect.tryPromise(() =>
        refreshOpenAIAuth({
          getAuth: async () => auth,
          setAuth: async (_expected, next) => {
            updates += 1
            auth = next
            return true
          },
          issuer: server.url.origin,
        }),
      ),
    )
    await waitFor(() => refreshRequests === 1)
    await Effect.runPromise(Fiber.interrupt(fiber))
    resolveRefresh!()
    await waitFor(() => updates === 1)

    expect(auth.access).toBe("access-new")
    expect(auth.refresh).toBe("refresh-new")
  })

  test("preserves OpenAI auth changed during refresh", async () => {
    let auth: OpenAIOAuth = {
      type: "oauth",
      refresh: "refresh-old",
      access: "access-old",
      expires: 0,
    }
    let updates = 0
    let refreshRequests = 0
    let resolveRefresh: (() => void) | undefined
    const refreshReady = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })

    using server = Bun.serve({
      port: 0,
      async fetch() {
        refreshRequests += 1
        await refreshReady
        return Response.json({
          id_token: createTestJwt({ chatgpt_account_id: "acc-old" }),
          access_token: "access-refreshed",
          refresh_token: "refresh-refreshed",
          expires_in: 3600,
        })
      },
    })

    const refreshing = refreshOpenAIAuth({
      getAuth: async () => auth,
      setAuth: async (expected, next) => {
        if (auth.access !== expected.access || auth.refresh !== expected.refresh || auth.expires !== expected.expires) {
          return false
        }
        updates += 1
        auth = next
        return true
      },
      issuer: server.url.origin,
    })
    await waitFor(() => refreshRequests === 1)
    auth = {
      type: "oauth",
      refresh: "refresh-login",
      access: "access-login",
      expires: Date.now() + 3_600_000,
      accountId: "acc-login",
    }
    resolveRefresh!()

    const refreshed = await refreshing
    expect(refreshed.access).toBe("access-login")
    expect(refreshed.refresh).toBe("refresh-login")
    expect(refreshed.accountId).toBe("acc-login")
    expect(updates).toBe(0)
  })

  test("rejects refresh for environment-backed OpenAI auth", async () => {
    await expect(
      refreshOpenAIAuth({
        getAuth: async () => {
          throw new Error("should not read auth")
        },
        setAuth: async () => {
          throw new Error("should not write auth")
        },
        environmentBacked: true,
      }),
    ).rejects.toThrow("cannot be refreshed durably")
  })

  test("retains the current refresh token when OpenAI omits a replacement", async () => {
    let auth: OpenAIOAuth = {
      type: "oauth",
      refresh: "refresh-old",
      access: "access-old",
      expires: 0,
      fedramp: true,
    }

    using server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          access_token: createTestJwt({
            chatgpt_account_id: "acc-123",
          }),
          expires_in: 3600,
        })
      },
    })

    const refreshed = await refreshOpenAIAuth({
      getAuth: async () => auth,
      setAuth: async (_expected, next) => {
        auth = next
        return true
      },
      issuer: server.url.origin,
    })

    expect(refreshed.refresh).toBe("refresh-old")
    expect(refreshed.fedramp).toBe(true)
  })

  test("deduplicates Codex refreshes without sharing caller cancellation", async () => {
    let auth = {
      type: "oauth" as const,
      refresh: "refresh-old",
      access: "",
      expires: 0,
    }
    let resolveRefresh: (() => void) | undefined
    const refreshReady = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    let refreshRequests = 0
    const apiRequests: { authorization: string | null; accountId: string | null }[] = []

    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/backend-api/codex/responses") {
          apiRequests.push({
            authorization: request.headers.get("authorization"),
            accountId: request.headers.get("ChatGPT-Account-Id"),
          })
          return new Response("{}", { status: 200 })
        }

        return new Response("unexpected request", { status: 500 })
      },
    })

    const hooks = await CodexAuthPlugin(
      {
        client: {
          auth: {
            async refresh() {
              refreshRequests += 1
              await refreshReady
              return {
                data: {
                  type: "oauth",
                  access: "access-new",
                  expires: Date.now() + 3_600_000,
                  accountId: "acc-123",
                  fedramp: false,
                },
              }
            },
          },
        } as never,
        project: {} as never,
        directory: "",
        worktree: "",
        experimental_workspace: {
          register() {},
        },
        serverUrl: new URL("https://example.com"),
        $: {} as never,
      },
      {
        codexApiEndpoint: new URL("/backend-api/codex/responses", server.url).toString(),
      },
    )
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)

    const controller = new AbortController()
    const first = loaded.fetch!("https://api.openai.com/v1/responses", { signal: controller.signal })
    const second = loaded.fetch!("https://api.openai.com/v1/responses")

    await waitFor(() => refreshRequests === 1)
    expect(apiRequests).toHaveLength(0)

    controller.abort(new Error("cancelled"))
    await expect(first).rejects.toThrow("cancelled")
    resolveRefresh!()
    await second

    expect(refreshRequests).toBe(1)
    expect(auth.access).toBe("access-new")
    expect(apiRequests).toEqual([{ authorization: "Bearer access-new", accountId: "acc-123" }])

    auth.access = ""
    auth.expires = 0
    const aborted = new AbortController()
    aborted.abort(new Error("pre-cancelled"))
    await expect(loaded.fetch!("https://api.openai.com/v1/responses", { signal: aborted.signal })).rejects.toThrow(
      "pre-cancelled",
    )
    expect(refreshRequests).toBe(1)
  })
})

async function waitFor(predicate: () => boolean) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1_000) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}
