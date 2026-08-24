import { expect, test } from "bun:test"
import { viteApiProxy } from "./vite-proxy"

test("rewrites proxied API origins to the loopback server", () => {
  expect(viteApiProxy("http://127.0.0.1:4106")).toEqual({
    target: "http://127.0.0.1:4106",
    changeOrigin: true,
    headers: { origin: "http://127.0.0.1:4106" },
  })
})
