import { ChevronDown, Circle, CircleCheck, CircleDashed, CircleX } from "lucide-react"
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue"
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
  if (todos.length === 0) return null

  const remaining = todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length

  return (
    <Queue className="rounded-lg px-2 py-1 shadow-none">
      <QueueSection>
        <QueueSectionTrigger className="hit-area bg-transparent px-1 py-1 text-xs text-foreground">
          <span className="flex items-center gap-2">
            <ChevronDown aria-hidden className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
            Todos · {remaining} remaining of {todos.length}
          </span>
        </QueueSectionTrigger>
        <QueueSectionContent>
          <QueueList className="mt-1">
            {todos.map((todo) => {
              const Icon = STATUS_ICON[todo.status]
              const struck = todo.status === "completed" || todo.status === "cancelled"
              return (
                <QueueItem key={todo.id} className="px-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Icon aria-hidden className={cn("size-3.5 shrink-0", STATUS_ICON_CLASS[todo.status])} />
                    <QueueItemContent completed={struck} className={cn(!struck && "text-foreground")}>{todo.text}</QueueItemContent>
                  </div>
                </QueueItem>
              )
            })}
          </QueueList>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  )
}
