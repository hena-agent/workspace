import { cn } from "@/lib/utils"

type LegacyIconName =
  | "archive"
  | "close"
  | "dot-grid"
  | "edit"
  | "folder-add-left"
  | "help"
  | "menu"
  | "plus"
  | "settings-gear"
  | "sidebar"
  | "sidebar-active"

export function LegacyIcon({ name, className }: { name: LegacyIconName; className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox={name === "edit" ? "0 0 16 16" : "0 0 20 20"}
      fill="none"
      className={cn("size-5 shrink-0", className)}
    >
      {body(name)}
    </svg>
  )
}

function body(name: LegacyIconName) {
  if (name === "close") {
    return <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeLinecap="square" />
  }
  if (name === "menu") {
    return <path d="M2.5 5H17.5M2.5 10H17.5M2.5 15H17.5" stroke="currentColor" strokeLinecap="square" />
  }
  if (name === "sidebar") {
    return <path d="M7.87 2H5.2H2V18H5.2H7.87M7.87 2H18V18H7.87M7.87 2V18" stroke="currentColor" />
  }
  if (name === "sidebar-active") {
    return (
      <>
        <path d="M2 2V18H5.2H7.87V2H5.2H2Z" fill="currentColor" fillOpacity="0.1" />
        <path d="M7.87 2H5.2H2V18H5.2H7.87M7.87 2H18V18H7.87M7.87 2V18" stroke="currentColor" />
      </>
    )
  }
  if (name === "plus") {
    return <path d="M10 2.21V17.79M2.21 10H17.79" stroke="currentColor" strokeLinecap="square" />
  }
  if (name === "help") {
    return (
      <path
        d="M7.92 7.92V6.25H12.08V8.75L10 10V12.09M10 13.75V13.76M17.92 10C17.92 14.37 14.37 17.92 10 17.92C5.63 17.92 2.08 14.37 2.08 10C2.08 5.63 5.63 2.09 10 2.09C14.37 2.09 17.92 5.63 17.92 10Z"
        stroke="currentColor"
        strokeLinecap="square"
      />
    )
  }
  if (name === "settings-gear") {
    return (
      <>
        <path
          d="M7.63 4.46L5.05 3.87L3.86 5.05L4.46 7.63L2.08 9.21V10.79L4.46 12.38L3.86 14.95L5.05 16.14L7.63 15.54L9.21 17.92H10.79L12.38 15.54L14.95 16.14L16.14 14.95L15.54 12.38L17.92 10.79V9.21L15.54 7.63L16.14 5.05L14.95 3.87L12.38 4.46L10.79 2.09H9.21L7.63 4.46Z"
          stroke="currentColor"
        />
        <path
          d="M12.5 10C12.5 11.38 11.38 12.5 10 12.5C8.62 12.5 7.5 11.38 7.5 10C7.5 8.62 8.62 7.5 10 7.5C11.38 7.5 12.5 8.62 12.5 10Z"
          stroke="currentColor"
        />
      </>
    )
  }
  if (name === "folder-add-left") {
    return (
      <path
        d="M2.08 9.58V2.92H8.33L10 5.42H17.92V16.25H8.75M3.75 12.08V17.08M1.25 14.58H6.25"
        stroke="currentColor"
        strokeLinecap="square"
      />
    )
  }
  if (name === "dot-grid") {
    return (
      <>
        <path d="M2.08 9.17H3.75V10.83H2.08V9.17Z" fill="currentColor" />
        <path d="M9.17 9.17H10.83V10.83H9.17V9.17Z" fill="currentColor" />
        <path d="M16.25 9.17H17.92V10.83H16.25V9.17Z" fill="currentColor" />
      </>
    )
  }
  if (name === "archive") {
    return (
      <path d="M16.87 6.25V16.87H3.12V6.25M2.08 2.92H17.92V6.25H2.08V2.92ZM8.33 9.58H11.67" stroke="currentColor" />
    )
  }
  if (name === "edit") {
    return (
      <path
        d="M13.56 8.22V13.56H2.44L2.44 2.44H7.78M6.89 9.11C6.89 9.11 8.96 9.04 9.7 8.3L14.03 3.97C14.58 3.42 14.58 2.52 14.03 1.97C13.48 1.42 12.58 1.42 12.03 1.97L7.7 6.3C7.01 6.99 6.89 9.11 6.89 9.11Z"
        stroke="currentColor"
      />
    )
  }

  name satisfies never
  return null
}
