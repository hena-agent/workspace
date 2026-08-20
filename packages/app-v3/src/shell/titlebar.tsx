import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { LegacyIcon } from "./legacy-icon"

export function Titlebar({
  onToggleMobileNav,
  onToggleSidebar,
  mobileNavOpen,
  sidebarOpen,
  title,
  children,
}: {
  onToggleMobileNav: () => void
  onToggleSidebar: () => void
  mobileNavOpen: boolean
  sidebarOpen: boolean
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="relative flex h-10 shrink-0 items-center overflow-hidden bg-[var(--legacy-background-base)]">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle menu"
        aria-expanded={mobileNavOpen}
        onClick={onToggleMobileNav}
        className="legacy-titlebar-button absolute top-2 left-4 xl:hidden"
      >
        <LegacyIcon name="menu" className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle sidebar"
        aria-expanded={sidebarOpen}
        onClick={onToggleSidebar}
        className="legacy-titlebar-button absolute top-2 left-16 hidden xl:inline-flex"
      >
        <LegacyIcon name={sidebarOpen ? "sidebar-active" : "sidebar"} className="size-4" />
      </Button>
      <div className="pointer-events-none mx-auto max-w-[40vw] min-w-0 truncate text-[13px] font-medium text-[var(--legacy-text-strong)]">
        {title}
      </div>
      <div className="absolute right-2 flex shrink-0 items-center gap-1">{children}</div>
    </header>
  )
}
