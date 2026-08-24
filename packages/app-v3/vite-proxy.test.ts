import { expect, test } from "bun:test"
import { viteApiProxy } from "./vite-proxy"

test("preserves browser origins for server validation", () => {
  expect(viteApiProxy("http://127.0.0.1:4106")).toEqual({
    target: "http://127.0.0.1:4106",
    changeOrigin: true,
  })
})
