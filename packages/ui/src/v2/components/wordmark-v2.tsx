import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16" transform="translate(185 0) scale(3.07)">
            <path
              d="M0 3H6V15H18V3H24V39H18V21H6V39H0V3Z"
              fill="currentColor"
            />
            <path
              d="M30 3H54V9H36V18H51V24H36V33H54V39H30V3Z"
              fill="currentColor"
            />
            <path
              d="M60 3H66L78 27V3H84V39H78L66 15V39H60V3Z"
              fill="currentColor"
            />
            <path
              d="M96 3H108L114 9V39H108V24H96V39H90V9L96 3ZM96 18H108V9H96V18Z"
              fill="currentColor"
            />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
