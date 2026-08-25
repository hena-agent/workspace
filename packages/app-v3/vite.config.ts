import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteApiProxy } from "./vite-proxy.ts"

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
    // Server-v3 maps exact entries to http://<host>:5173 CORS origins.
    strictPort: true,
    allowedHosts: process.env.HENA_VITE_ALLOWED_HOSTS?.split(",")
      .map((host) => host.trim())
      .filter(Boolean),
    proxy: {
      "/api": viteApiProxy(process.env.HENA_SERVER_V3_URL ?? "http://127.0.0.1:4106"),
    },
  },
})
