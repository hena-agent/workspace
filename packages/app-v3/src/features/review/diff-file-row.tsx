import { cn } from "@/lib/utils"
import type { DiffFile } from "@/lib/types"

export function DiffFileRow({ file, active, onSelect }: { file: DiffFile; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex hit-area w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
      <span className="shrink-0 font-mono">
        <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{" "}
        <span className="text-destructive">-{file.deletions}</span>
      </span>
    </button>
  )
}
