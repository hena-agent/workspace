import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { ConnectionProvider } from "@/connection/provider"
import { createAppRouter } from "./router"

const router = createAppRouter()
const queryClient = new QueryClient()
const embeddedOrigin =
  import.meta.env.VITE_HENA_EMBEDDED === "true"
    ? new URL(import.meta.env.BASE_URL, window.location.origin).toString()
    : undefined

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider embeddedOrigin={embeddedOrigin}>
          <RouterProvider router={router} />
        </ConnectionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
