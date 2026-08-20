import { type ComponentProps, type PointerEvent, type ReactNode, useEffect, useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/hooks/use-media-query"
import { MobileNavDrawer } from "./mobile-nav-drawer"
import { Rail } from "./rail"
import { SidebarPanel } from "./sidebar-panel"
import { Titlebar } from "./titlebar"

const DESKTOP_QUERY = "(min-width: 1280px)"
const PANEL_MIN = 180

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
  const [sidebarOpen, setSidebarOpen] = useState(() => Boolean(sidebarPanel.project))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(280)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return
      event.preventDefault()
      if (isDesktop) {
        setSidebarOpen((open) => !open)
        return
      }
      setMobileNavOpen((open) => !open)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isDesktop])

  function selectProject(projectId: string) {
    if (isDesktop && projectId === rail.selectedProjectId) {
      setSidebarOpen((open) => !open)
      return
    }
    if (isDesktop) setSidebarOpen(true)
    setMobileNavOpen(false)
    rail.onSelectProject(projectId)
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth

    function onPointerMove(nextEvent: globalThis.PointerEvent) {
      setPanelWidth(Math.min(window.innerWidth * 0.3, Math.max(PANEL_MIN, startWidth + nextEvent.clientX - startX)))
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }

  const routedRail = { ...rail, onSelectProject: selectProject }
  const routedSidebar = {
    ...sidebarPanel,
    onSelectSession: (sessionId: string) => {
      setMobileNavOpen(false)
      sidebarPanel.onSelectSession(sessionId)
    },
    onNewSession: () => {
      setMobileNavOpen(false)
      sidebarPanel.onNewSession()
    },
  }

  return (
    <TooltipProvider>
      <div
        className="flex min-h-0 flex-1 flex-col bg-[var(--legacy-background-base)]"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <Titlebar
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          mobileNavOpen={mobileNavOpen}
          sidebarOpen={sidebarOpen}
          title={title}
        >
          {titlebarActions}
        </Titlebar>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <MobileNavDrawer
            open={mobileNavOpen}
            onOpenChange={setMobileNavOpen}
            rail={routedRail}
            sidebarPanel={routedSidebar}
          />

          {isDesktop ? (
            <>
              <nav
                aria-label="Projects and sessions"
                className="absolute inset-y-0 left-0 z-10 flex"
                style={{ width: sidebarOpen ? 64 + panelWidth : 64 }}
              >
                <Rail {...routedRail} />
                {sidebarOpen ? <SidebarPanel {...routedSidebar} width={panelWidth} /> : null}
                {sidebarOpen ? (
                  <div
                    role="separator"
                    aria-label="Resize sidebar"
                    aria-orientation="vertical"
                    onPointerDown={startResize}
                    className="group/resize absolute inset-y-0 right-0 z-30 w-2 translate-x-1/2 cursor-col-resize touch-none"
                  >
                    <span className="absolute inset-y-0 left-1/2 w-px bg-transparent transition-colors group-hover/resize:bg-[var(--legacy-border-weak)]" />
                  </div>
                ) : null}
              </nav>
            </>
          ) : null}

          <main
            className="flex size-full min-w-0 flex-col items-start overflow-x-hidden border-t border-[var(--legacy-border-weak)] bg-[var(--legacy-background-base)] [contain:strict] xl:rounded-tl-[12px] xl:border-l"
            style={{ marginLeft: isDesktop ? (sidebarOpen ? 64 + panelWidth : 64) : 0 }}
          >
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
