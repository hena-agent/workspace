import { Icon } from "@hena/ui/icon"
import type { LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"

export function ProjectModeIcon(props: { mode: LocalProject["mode"]; class?: string }) {
  const language = useLanguage()
  const chat = () => props.mode === "chat"
  const label = () => language.t(chat() ? "project.mode.chat" : "project.mode.code")

  return (
    <span
      role="img"
      aria-label={label()}
      title={label()}
      data-project-mode={chat() ? "chat" : "workspace"}
      class={`inline-flex size-4 shrink-0 items-center justify-center ${props.class ?? ""}`}
    >
      <Icon name={chat() ? "speech-bubble" : "code"} size="small" />
    </span>
  )
}
