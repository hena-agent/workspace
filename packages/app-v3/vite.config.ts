import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must run before the React plugin: it generates routeTree.gen.ts from
    // src/routes/** so the React plugin compiles routes with an up-to-date tree.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Only takes effect when the dev server is bound to a non-loopback
    // address (e.g. `vite --host 0.0.0.0`). Lets it accept requests for
    // hostnames like Tailscale MagicDNS names, not just localhost/IPs.
    allowedHosts: true,
  },
})
