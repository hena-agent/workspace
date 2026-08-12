import { useState } from "react"
import { ChevronDown, ChevronUp, Circle, CircleCheck, CircleDashed, CircleX } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { Todo } from "@/lib/types"

const STATUS_ICON = { pending: Circle, in_progress: CircleDashed, completed: CircleCheck, cancelled: CircleX } as const
const STATUS_ICON_CLASS = {
  pending: "text-muted-foreground",
  in_progress: "text-blue-500",
  completed: "text-emerald-500",
  cancelled: "text-muted-foreground",
} as const

export function TodoDock({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(true)

  if (todos.length === 0) return null

  const remaining = todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border px-3 py-2">
      <CollapsibleTrigger className="flex hit-area w-full items-center justify-between text-xs font-medium">
        <span>
          Todos · {remaining} remaining of {todos.length}
        </span>
        {open ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-1.5">
        {todos.map((todo) => {
          const Icon = STATUS_ICON[todo.status]
          const struck = todo.status === "completed" || todo.status === "cancelled"
          return (
            <div key={todo.id} className="flex items-center gap-2 text-xs">
              <Icon aria-hidden className={cn("size-3.5 shrink-0", STATUS_ICON_CLASS[todo.status])} />
              <span className={cn(struck && "text-muted-foreground line-through")}>{todo.text}</span>
            </div>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}
