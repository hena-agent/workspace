import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
})

function SettingsLayout() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold">Settings</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
          onClick={() => navigate({ to: "/" })}
          className="hit-area"
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
