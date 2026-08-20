import { type ComponentProps, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/hooks/use-media-query"
import type { Project } from "@/lib/types"
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
  const [mobileNavOpen, setMobileNavOpen] = useState(() => Boolean(window.history.state?.henaMobileNavigation))
  const [panelWidth, setPanelWidth] = useState(280)
  const mobileNavOpenRef = useRef(mobileNavOpen)
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null)
  const mobileNavRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const pendingMobileNavActionRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && mobileNavOpen) {
        const items = [
          mobileNavButtonRef.current,
          ...Array.from(mobileNavRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? []),
        ].filter((item): item is HTMLElement => Boolean(item))
        const first = items[0]
        const last = items.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === mobileNavRef.current)) {
          event.preventDefault()
          last?.focus()
          return
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
          return
        }
      }
      if (event.key === "Escape" && mobileNavOpen && !event.defaultPrevented) {
        closeMobileNav()
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return
      event.preventDefault()
      if (isDesktop) {
        setSidebarOpen((open) => !open)
        return
      }
      if (mobileNavOpen) {
        closeMobileNav()
        return
      }
      openMobileNav()
    }
    function onPopState(event: PopStateEvent) {
      if (event.state?.henaMobileNavigation) {
        if (!mobileNavOpenRef.current) {
          mobileNavOpenRef.current = true
          setMobileNavOpen(true)
          queueMicrotask(() => mobileNavRef.current?.focus())
        }
        return
      }
      if (mobileNavOpenRef.current) finishMobileNavClose()
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("popstate", onPopState)
    }
  }, [isDesktop, mobileNavOpen])

  useEffect(() => {
    if (!isDesktop || !mobileNavOpen) return
    if (pendingMobileNavActionRef.current) return
    closeMobileNav(() => mainRef.current?.focus())
  }, [isDesktop, mobileNavOpen])

  useEffect(() => {
    if (!mobileNavOpen || isDesktop || document.activeElement === mobileNavRef.current) return
    queueMicrotask(() => mobileNavRef.current?.focus())
  }, [isDesktop, mobileNavOpen])

  function openMobileNav() {
    const state = window.history.state
    window.history.pushState({ ...(typeof state === "object" && state ? state : {}), henaMobileNavigation: true }, "")
    mobileNavOpenRef.current = true
    setMobileNavOpen(true)
    queueMicrotask(() => mobileNavRef.current?.focus())
  }

  function closeMobileNav(action?: () => void) {
    pendingMobileNavActionRef.current = action ?? null
    if (window.history.state?.henaMobileNavigation) {
      window.history.back()
      return
    }
    finishMobileNavClose()
  }

  function finishMobileNavClose() {
    mobileNavOpenRef.current = false
    setMobileNavOpen(false)
    const action = pendingMobileNavActionRef.current
    pendingMobileNavActionRef.current = null
    if (!action) {
      mobileNavButtonRef.current?.focus()
      return
    }
    action()
    queueMicrotask(() => mainRef.current?.focus())
  }

  function runAfterMobileNavClose(action: () => void) {
    if (mobileNavOpen) {
      closeMobileNav(action)
      return
    }
    action()
  }

  function selectProject(project: Project) {
    if (
      isDesktop &&
      project.id === rail.selectedProject?.id &&
      project.connectionId === rail.selectedProject.connectionId
    ) {
      setSidebarOpen((open) => !open)
      return
    }
    if (isDesktop) {
      setSidebarOpen(true)
      rail.onSelectProject(project)
      return
    }
    runAfterMobileNavClose(() => rail.onSelectProject(project))
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

  const routedRail = {
    ...rail,
    onSelectProject: selectProject,
    onAddProject: () => runAfterMobileNavClose(rail.onAddProject),
    onOpenSettings: () => runAfterMobileNavClose(rail.onOpenSettings),
  }
  const routedSidebar = {
    ...sidebarPanel,
    onSelectSession: (sessionId: string) => runAfterMobileNavClose(() => sidebarPanel.onSelectSession(sessionId)),
    onNewSession: () => runAfterMobileNavClose(sidebarPanel.onNewSession),
    onCloseProject: () => runAfterMobileNavClose(sidebarPanel.onCloseProject),
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
          onToggleMobileNav={() => (mobileNavOpen ? closeMobileNav() : openMobileNav())}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          mobileNavButtonRef={mobileNavButtonRef}
          mobileNavOpen={mobileNavOpen}
          sidebarOpen={sidebarOpen}
          title={title}
        >
          {titlebarActions}
        </Titlebar>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <MobileNavDrawer
            open={mobileNavOpen}
            drawerRef={mobileNavRef}
            onOpenChange={(open) => (open ? openMobileNav() : closeMobileNav())}
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
            ref={mainRef}
            tabIndex={-1}
            inert={mobileNavOpen && !isDesktop}
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
