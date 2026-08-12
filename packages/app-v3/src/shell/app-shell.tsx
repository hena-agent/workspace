import { type ComponentProps, type ReactNode, useState } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/hooks/use-media-query"
import { MobileNavDrawer } from "./mobile-nav-drawer"
import { Rail } from "./rail"
import { SidebarPanel } from "./sidebar-panel"
import { Titlebar } from "./titlebar"

// Below this, the shell is a single routed page plus a drawer; at or above
// it, the rail and session list become persistent chrome (spec §7.4/§7.2).
const DESKTOP_QUERY = "(min-width: 768px)"

export function AppShell({
  rail,
  sidebarPanel,
  title,
  titlebarActions,
  children,
}: {
  rail: ComponentProps<typeof Rail>
  sidebarPanel: ComponentProps<typeof SidebarPanel>
  title?: ReactNode
  titlebarActions?: ReactNode
  children: ReactNode
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    // Rail's project tiles and footer buttons render shadcn Tooltips; owning
    // the provider here (rather than trusting the app entry point to add it)
    // keeps AppShell self-sufficient wherever it's mounted.
    <TooltipProvider>
      <div className="flex h-dvh min-h-0 flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <Titlebar
          onToggleMobileNav={() => setMobileNavOpen(true)}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          sidebarOpen={sidebarOpen}
          title={title}
        >
          {titlebarActions}
        </Titlebar>

        <MobileNavDrawer open={mobileNavOpen} onOpenChange={setMobileNavOpen} rail={rail} sidebarPanel={sidebarPanel} />

        {/*
         * `children` (the routed page) is mounted in exactly one of the three
         * branches below, never CSS-hidden duplicates: a page with any local
         * state (composer draft, scroll position) must not exist twice.
         */}
        {!isDesktop ? (
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        ) : (
          <div className="flex min-h-0 flex-1">
            <Rail {...rail} className="border-r border-border" />
            {sidebarOpen ? (
              <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
                <ResizablePanel defaultSize="340px" minSize="240px" maxSize="480px" className="border-r border-border">
                  <SidebarPanel {...sidebarPanel} />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel>
                  <main className="h-full overflow-y-auto">{children}</main>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
