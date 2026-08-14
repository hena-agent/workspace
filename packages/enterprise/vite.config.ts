import { defineConfig } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [tailwindcss(), solidStart(), nitro()],
  nitro: {
    exportConditions: ["!wasm", "!unwasm"],
    ...(process.env.HENA_DEPLOYMENT_TARGET === "cloudflare"
      ? {
          compatibilityDate: "2024-09-19" as const,
          preset: "cloudflare-module",
          cloudflare: {
            nodeCompat: true,
          },
        }
      : {}),
    baseURL: process.env.HENA_BASE_URL,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3002,
  },
  worker: {
    format: "es",
  },
})
