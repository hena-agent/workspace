import { cn } from "@/lib/utils"

type LegacyIconName =
  | "archive"
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
  if (name === "menu") {
    return <path d="M2.5 5H17.5M2.5 10H17.5M2.5 15H17.5" stroke="currentColor" strokeLinecap="square" />
  }
  if (name === "sidebar") {
    return <path d="M7.86667 2H5.2H2V18H5.2H7.86667M7.86667 2H18V18H7.86667M7.86667 2V18" stroke="currentColor" />
  }
  if (name === "sidebar-active") {
    return (
      <>
        <path d="M2 2V18H5.2H7.86667V2H5.2H2Z" fill="currentColor" fillOpacity="0.1" />
        <path d="M7.86667 2H5.2H2V18H5.2H7.86667M7.86667 2H18V18H7.86667M7.86667 2V18" stroke="currentColor" />
      </>
    )
  }
  if (name === "plus") {
    return <path d="M9.9987 2.20703V17.7904M2.20703 9.9987H17.7904" stroke="currentColor" strokeLinecap="square" />
  }
  if (name === "help") {
    return (
      <path
        d="M7.91683 7.91927V6.2526H12.0835V8.7526L10.0002 10.0026V12.0859M10.0002 13.7526V13.7609M17.9168 10.0026C17.9168 14.3749 14.3724 17.9193 10.0002 17.9193C5.62791 17.9193 2.0835 14.3749 2.0835 10.0026C2.0835 5.63035 5.62791 2.08594 10.0002 2.08594C14.3724 2.08594 17.9168 5.63035 17.9168 10.0026Z"
        stroke="currentColor"
        strokeLinecap="square"
      />
    )
  }
  if (name === "settings-gear") {
    return (
      <>
        <path
          d="M7.62516 4.46094L5.05225 3.86719L3.86475 5.05469L4.4585 7.6276L2.0835 9.21094V10.7943L4.4585 12.3776L3.86475 14.9505L5.05225 16.138L7.62516 15.5443L9.2085 17.9193H10.7918L12.3752 15.5443L14.9481 16.138L16.1356 14.9505L15.5418 12.3776L17.9168 10.7943V9.21094L15.5418 7.6276L16.1356 5.05469L14.9481 3.86719L12.3752 4.46094L10.7918 2.08594H9.2085L7.62516 4.46094Z"
          stroke="currentColor"
        />
        <path
          d="M12.5002 10.0026C12.5002 11.3833 11.3809 12.5026 10.0002 12.5026C8.61945 12.5026 7.50016 11.3833 7.50016 10.0026C7.50016 8.62189 8.61945 7.5026 10.0002 7.5026C11.3809 7.5026 12.5002 8.62189 12.5002 10.0026Z"
          stroke="currentColor"
        />
      </>
    )
  }
  if (name === "folder-add-left") {
    return (
      <path
        d="M2.08333 9.58268V2.91602H8.33333L10 5.41602H17.9167V16.2493H8.75M3.75 12.0827V17.0827M1.25 14.5827H6.25"
        stroke="currentColor"
        strokeLinecap="square"
      />
    )
  }
  if (name === "dot-grid") {
    return (
      <>
        <path d="M2.08398 9.16602H3.75065V10.8327H2.08398V9.16602Z" fill="currentColor" />
        <path d="M9.16732 9.16602H10.834V10.8327H9.16732V9.16602Z" fill="currentColor" />
        <path d="M16.2507 9.16602H17.9173V10.8327H16.2507V9.16602Z" fill="currentColor" />
      </>
    )
  }
  if (name === "archive") {
    return (
      <path
        d="M16.8747 6.24935V16.8743H3.12467V6.24935M2.08301 2.91602H17.9163V6.24935H2.08301V2.91602ZM8.33301 9.58268H11.6663"
        stroke="currentColor"
      />
    )
  }
  if (name === "edit") {
    return (
      <path
        d="M13.5555 8.21534V13.5556H2.44434L2.44434 2.4445H7.78462M6.88878 9.11119C6.88878 9.11119 8.96327 9.0367 9.69678 8.3032L14.0301 3.96986C14.5824 3.4176 14.5824 2.52213 14.0301 1.96986C13.4778 1.4176 12.5824 1.4176 12.0301 1.96986L7.69678 6.3032C7.00513 6.99484 6.88878 9.11119 6.88878 9.11119Z"
        stroke="currentColor"
      />
    )
  }

  name satisfies never
  return null
}
