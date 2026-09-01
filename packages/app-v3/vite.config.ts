import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import babel from "@rolldown/plugin-babel"
import { portlessAppPort, portlessOrigins } from "@hena/server-v3/portless"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteApiProxy } from "./vite-proxy.ts"

const portlessURLs = portlessOrigins().map((url) => new URL(url))
const appPort = portlessAppPort()
const allowedHosts = [
  ...(process.env.HENA_VITE_ALLOWED_HOSTS?.split(",") ?? []),
  ...portlessURLs.map((url) => url.hostname),
]
  .map((host) => host.trim())
  .filter(Boolean)

// https://vite.dev/config/
export default defineConfig({
  base: process.env.HENA_APP_BASE_PATH ?? "/",
  plugins: [
    // Must run before the React plugin: it generates routeTree.gen.ts from
    // src/routes/** so the React plugin compiles routes with an up-to-date tree.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: appPort,
    // Keep explicit hosts so Vite's DNS rebinding protection remains enabled.
    strictPort: true,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    proxy: {
      "/api": viteApiProxy(process.env.HENA_SERVER_V3_URL ?? `http://127.0.0.1:${appPort ? appPort + 10_000 : 4106}`),
    },
  },
})
