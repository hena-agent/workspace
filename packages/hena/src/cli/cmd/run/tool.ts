import os from "os"
import path from "path"
import type { ToolPart } from "@hena/sdk/v2"

export type ToolInline = {
  icon: string
  title: string
  description?: string
  mode?: "inline" | "block"
  body?: string
}

function dict(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function count(value: unknown, label: string) {
  if (typeof value !== "number") return ""
  return `${value} ${label}${value === 1 ? "" : "es"}`
}

function info(input: Record<string, unknown>, skip: string[] = []) {
  const values = Object.entries(input).filter(
    ([key, value]) =>
      !skip.includes(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
  )
  return values.length ? `[${values.map(([key, value]) => `${key}=${String(value)}`).join(", ")}]` : ""
}

export function toolPath(input?: string, options: { home?: boolean } = {}): string {
  if (!input) return ""
  const cwd = process.cwd()
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)
  if (!relative) return "."
  if (!relative.startsWith("..")) return relative.replaceAll("\\", "/")
  if (options.home && (absolute === os.homedir() || absolute.startsWith(os.homedir() + path.sep))) {
    return absolute.replace(os.homedir(), "~").replaceAll("\\", "/")
  }
  return absolute.replaceAll("\\", "/")
}

export function toolInlineInfo(part: ToolPart): ToolInline {
  const state = dict(part.state)
  const input = dict(state.input)
  const metadata = "metadata" in part.state ? dict(part.state.metadata) : {}
  const output = text(state.output)

  switch (part.tool) {
    case "bash":
      return { icon: "$", title: text(input.command), mode: "block", body: output.trim() || undefined }
    case "read": {
      const description = info(input, ["filePath"]) || undefined
      return { icon: "→", title: `Read ${toolPath(text(input.filePath))}`, ...(description && { description }) }
    }
    case "write":
      return { icon: "←", title: `Write ${toolPath(text(input.filePath))}`, mode: "block", body: output || undefined }
    case "edit":
      return {
        icon: "←",
        title: `Edit ${toolPath(text(input.filePath))}`,
        mode: "block",
        body: text(metadata.diff) || undefined,
      }
    case "apply_patch": {
      const files = Array.isArray(metadata.files) ? metadata.files.length : 0
      return { icon: "%", title: files ? `Patch ${files} file${files === 1 ? "" : "s"}` : "Patch" }
    }
    case "glob": {
      const root = text(input.path)
      const matches = count(metadata.count, "match")
      const location = root ? `in ${toolPath(root)}` : ""
      const description = [location, matches].filter(Boolean).join(" · ") || undefined
      return { icon: "✱", title: `Glob "${text(input.pattern)}"`, ...(description && { description }) }
    }
    case "grep": {
      const root = text(input.path)
      const matches = count(metadata.matches, "match")
      const location = root ? `in ${toolPath(root)}` : ""
      const description = [location, matches].filter(Boolean).join(" · ") || undefined
      return { icon: "✱", title: `Grep "${text(input.pattern)}"`, ...(description && { description }) }
    }
    case "list":
      return { icon: "→", title: input.path ? `List ${toolPath(text(input.path))}` : "List" }
    case "webfetch":
      return { icon: "%", title: input.url ? `WebFetch ${text(input.url)}` : "WebFetch" }
    case "websearch":
      return { icon: "◈", title: input.query ? `Web search "${text(input.query)}"` : "Web search" }
    case "task": {
      const description = text(input.description)
      const kind = text(input.subagent_type).replace(/\b\w/g, (character) => character.toUpperCase()) || "Unknown"
      return {
        icon: state.status === "error" ? "✗" : state.status === "running" ? "•" : "✓",
        title: description || `${kind} Task`,
        description: description ? `${kind} Agent` : undefined,
      }
    }
    case "todowrite": {
      const body = Array.isArray(input.todos)
        ? input.todos
            .flatMap((value) => {
              const item = dict(value)
              const content = text(item.content)
              if (!content) return []
              const mark = item.status === "completed" ? "[✓]" : item.status === "in_progress" ? "[•]" : "[ ]"
              return [`${mark} ${content}`]
            })
            .join("\n")
        : ""
      return { icon: "#", title: "Todos", mode: "block", body }
    }
    case "question": {
      const total = Array.isArray(input.questions) ? input.questions.length : 0
      return { icon: "→", title: `Asked ${total} question${total === 1 ? "" : "s"}` }
    }
    case "skill":
      return { icon: "→", title: `Skill "${text(input.name)}"` }
    case "lsp":
      return { icon: "→", title: text(state.title) || `LSP ${text(input.operation) || "request"}` }
    case "plan_exit":
      return { icon: "→", title: text(state.title) || "Switching to build agent", mode: "block", body: output || undefined }
    case "invalid":
      return { icon: "✗", title: text(state.title) || "Invalid Tool", mode: "block", body: output || undefined }
    default:
      return {
        icon: "⚙",
        title: `${part.tool} ${text(state.title) || (Object.keys(input).length ? JSON.stringify(input) : "Unknown")}`,
      }
  }
}
