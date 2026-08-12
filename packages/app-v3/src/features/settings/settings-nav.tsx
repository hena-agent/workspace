import { cn } from "@/lib/utils"

export function SettingsNav<T extends string>({
  sections,
  active,
  onSelect,
}: {
  sections: ReadonlyArray<{ id: T; label: string }>
  active: T
  onSelect: (id: T) => void
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="no-scrollbar flex gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-visible"
    >
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onSelect(section.id)}
          aria-current={section.id === active ? "true" : undefined}
          className={cn(
            "hit-area shrink-0 rounded-md px-3 py-1.5 text-left text-sm",
            section.id === active ? "bg-accent font-medium" : "hover:bg-accent/60",
          )}
        >
          {section.label}
        </button>
      ))}
    </nav>
  )
}
