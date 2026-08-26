import type { ReactElement, ReactNode } from "react"
import { render, type RenderOptions, type RenderResult } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"

function AllProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(ui, { wrapper: AllProviders, ...options })
}

export { renderWithProviders as render }
export * from "@testing-library/react"
