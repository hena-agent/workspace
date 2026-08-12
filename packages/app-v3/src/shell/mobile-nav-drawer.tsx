import type { ComponentProps } from "react"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full max-w-[400px] flex-row gap-0 p-0">
        <SheetTitle className="sr-only">Projects and sessions</SheetTitle>
        <SheetDescription className="sr-only">Browse projects and open a session.</SheetDescription>
        <Rail {...rail} className="border-r border-border" />
        <div className="min-w-0 flex-1">
          <SidebarPanel {...sidebarPanel} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
