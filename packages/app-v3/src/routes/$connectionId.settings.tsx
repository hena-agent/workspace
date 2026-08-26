import { createFileRoute, Outlet, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/$connectionId/settings")({
  component: SettingsLayout,
})

function SettingsLayout() {
  const { connectionId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()

  function closeSettings() {
    if (canGoBack) {
      router.history.back()
      return
    }
    void navigate({ to: "/$connectionId", params: { connectionId }, replace: true })
  }

  return (
    <div className="flex size-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--legacy-border-weaker)] px-4 py-2.5">
        <h1 className="text-sm font-semibold">Settings</h1>
        <Button variant="ghost" size="icon-sm" aria-label="Close settings" onClick={closeSettings} className="hit-area">
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
