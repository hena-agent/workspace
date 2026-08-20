import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { Rail } from "./rail"
import { SidebarPanel } from "./sidebar-panel"

export function MobileNavDrawer({
  open,
  onOpenChange,
  rail,
  sidebarPanel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rail: ComponentProps<typeof Rail>
  sidebarPanel: ComponentProps<typeof SidebarPanel>
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close navigation"
        aria-hidden={!open}
        inert={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => onOpenChange(false)}
        className={cn(
          "fixed inset-x-0 top-10 bottom-0 z-40 bg-transparent transition-opacity duration-200 xl:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <nav
        aria-label="Projects and sessions"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "fixed top-10 bottom-0 left-0 z-50 flex w-full max-w-[400px] overflow-hidden border-r border-[var(--legacy-border-weaker)] bg-[var(--legacy-background-base)] transition-transform duration-200 ease-out xl:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Rail {...rail} />
        <SidebarPanel {...sidebarPanel} mobile />
      </nav>
    </>
  )
}
