import type { ReactNode } from "react"
import { Menu, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Titlebar({
  onToggleMobileNav,
  onToggleSidebar,
  sidebarOpen,
  title,
  children,
}: {
  onToggleMobileNav: () => void
  onToggleSidebar: () => void
  sidebarOpen: boolean
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        onClick={onToggleMobileNav}
        className="hit-area md:hidden"
      >
        <Menu />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle sidebar"
        aria-pressed={sidebarOpen}
        onClick={onToggleSidebar}
        className="hidden hit-area md:inline-flex"
      >
        <PanelLeft />
      </Button>
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </header>
  )
}
