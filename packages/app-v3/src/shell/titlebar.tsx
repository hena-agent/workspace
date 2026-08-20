import type { ReactNode, RefObject } from "react"
import { Button } from "@/components/ui/button"
import { LegacyIcon } from "./legacy-icon"

export function Titlebar({
  onToggleMobileNav,
  onToggleSidebar,
  mobileNavButtonRef,
  mobileNavOpen,
  sidebarOpen,
  title,
  children,
}: {
  onToggleMobileNav: () => void
  onToggleSidebar: () => void
  mobileNavButtonRef: RefObject<HTMLButtonElement | null>
  mobileNavOpen: boolean
  sidebarOpen: boolean
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="relative flex h-[max(40px,var(--hit-area))] shrink-0 items-center overflow-hidden bg-[var(--legacy-background-base)]">
      <Button
        ref={mobileNavButtonRef}
        id="mobile-navigation-trigger"
        variant="ghost"
        size="icon"
        aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
        aria-controls="mobile-navigation"
        aria-expanded={mobileNavOpen}
        onClick={onToggleMobileNav}
        className="legacy-titlebar-button absolute top-1/2 left-4 -translate-y-1/2 xl:hidden"
      >
        <LegacyIcon name={mobileNavOpen ? "close" : "menu"} className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle sidebar"
        aria-expanded={sidebarOpen}
        onClick={onToggleSidebar}
        className="legacy-titlebar-button absolute top-1/2 left-16 hidden -translate-y-1/2 xl:inline-flex"
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
