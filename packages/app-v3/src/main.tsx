import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { MockServerProvider } from "@/features/server/mock-server-provider"
import { createAppRouter } from "./router"

const router = createAppRouter()
const embeddedOrigin =
  !import.meta.env.DEV &&
  (window.location.protocol === "http:" || window.location.protocol === "https:") &&
  window.location.hostname !== "app.hena.dev"
    ? new URL(import.meta.env.BASE_URL, window.location.origin).toString()
    : undefined

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MockServerProvider embeddedOrigin={embeddedOrigin}>
        <RouterProvider router={router} />
      </MockServerProvider>
    </ThemeProvider>
  </StrictMode>,
)
