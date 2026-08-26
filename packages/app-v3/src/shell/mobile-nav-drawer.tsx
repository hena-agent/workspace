import type { ComponentProps, Ref } from "react"
import { cn } from "@/lib/utils"
import { Rail } from "./rail"
import { SidebarPanel } from "./sidebar-panel"

export function MobileNavDrawer({
  open,
  drawerRef,
  onOpenChange,
  rail,
  sidebarPanel,
}: {
  open: boolean
  drawerRef: Ref<HTMLElement>
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
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className={cn(
          "absolute inset-0 z-40 bg-black/10 transition-opacity duration-200 xl:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <nav
        ref={drawerRef}
        id="mobile-navigation"
        tabIndex={-1}
        aria-label="Projects and sessions"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "absolute inset-y-0 left-0 z-50 flex w-[calc(100%-2.5rem)] max-w-[400px] overflow-hidden border-r border-[var(--legacy-border-weaker)] bg-[var(--legacy-background-base)] transition-transform duration-200 ease-out xl:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Rail {...rail} />
        <SidebarPanel {...sidebarPanel} mobile />
      </nav>
    </>
  )
}
