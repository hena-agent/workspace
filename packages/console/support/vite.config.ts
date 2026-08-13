import { defineConfig } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"

export default defineConfig({
  plugins: [solidStart(), nitro()],
  nitro: {
    compatibilityDate: "2024-09-19",
    preset: "cloudflare-module",
    cloudflare: {
      nodeCompat: true,
    },
  },
  server: {
    allowedHosts: true,
  },
  build: {
    rolldownOptions: {
      external: ["cloudflare:workers"],
    },
    minify: false,
  },
})
