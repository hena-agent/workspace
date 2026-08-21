import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { MockServerProvider } from "@/features/server/mock-server-provider"
import { createAppRouter } from "./router"

const router = createAppRouter()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MockServerProvider
        embeddedOrigin={import.meta.env.VITE_HENA_EMBEDDED === "true" ? window.location.origin : undefined}
      >
        <RouterProvider router={router} />
      </MockServerProvider>
    </ThemeProvider>
  </StrictMode>,
)
