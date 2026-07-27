import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0H4V8H12V0H16V20H12V12H4V20H0V0Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0H20V40H60V0H80V100H60V60H20V100H0V0Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 114 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M0 3H6V15H18V3H24V39H18V21H6V39H0V3Z" fill="var(--icon-base)" />
        <path d="M30 3H54V9H36V18H51V24H36V33H54V39H30V3Z" fill="var(--icon-base)" />
        <path d="M60 3H66L78 27V3H84V39H78L66 15V39H60V3Z" fill="var(--icon-strong-base)" />
        <path d="M96 3H108L114 9V39H108V24H96V39H90V9L96 3ZM96 18H108V9H96V18Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
