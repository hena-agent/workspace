import { CircleHelp } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { QuestionRequest } from "@/lib/types"

export function QuestionDock({
  request,
  onChoose,
}: {
  request: QuestionRequest
  onChoose: (choiceId: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-500/40 bg-blue-500/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1 text-sm font-medium">{request.prompt}</div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {request.choices.map((choice) => (
          <Button key={choice.id} variant="outline" size="sm" onClick={() => onChoose(choice.id)} className="hit-area">
            {choice.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
