"use client"

import type { ComponentProps } from "react"
import { Collapsible } from "radix-ui"

function CollapsibleRoot({ ...props }: ComponentProps<typeof Collapsible.Root>) {
  return <Collapsible.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: ComponentProps<typeof Collapsible.CollapsibleTrigger>) {
  return <Collapsible.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent({ ...props }: ComponentProps<typeof Collapsible.CollapsibleContent>) {
  return <Collapsible.CollapsibleContent data-slot="collapsible-content" {...props} />
}

export { CollapsibleRoot as Collapsible, CollapsibleTrigger, CollapsibleContent }
