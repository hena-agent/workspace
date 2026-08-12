import { cn } from "@/lib/utils"
import type { DiffFile } from "@/lib/types"

const LINE_CLASS = {
  context: "",
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  delete: "bg-destructive/10 text-destructive",
} as const

export function DiffView({ file }: { file: DiffFile }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-muted px-3 py-1.5 font-mono text-xs">{file.path}</div>
      <div className="overflow-x-auto text-xs">
        {file.lines.map((line) => (
          <div
            key={line.id}
            data-kind={line.kind}
            className={cn("px-3 py-0.5 font-mono whitespace-pre-wrap", LINE_CLASS[line.kind])}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  )
}
