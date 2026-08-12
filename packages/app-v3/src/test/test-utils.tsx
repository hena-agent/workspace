import type { ReactElement, ReactNode } from "react"
import { render as rtlRender, type RenderOptions, type RenderResult } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"

function AllProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

export function render(ui: ReactElement, options?: RenderOptions): RenderResult {
  return rtlRender(ui, { wrapper: AllProviders, ...options })
}

export * from "@testing-library/react"
