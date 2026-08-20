import type { ComponentProps } from "react"
import { Dialog } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function DialogRoot({ ...props }: ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: ComponentProps<typeof Dialog.Portal>) {
  return <Dialog.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: ComponentProps<typeof Dialog.Overlay>) {
  return (
    <Dialog.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof Dialog.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <Dialog.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <Dialog.Close data-slot="dialog-close" asChild>
            <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </Dialog.Close>
        )}
      </Dialog.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <Dialog.Close asChild>
          <Button variant="outline">Close</Button>
        </Dialog.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

export {
  DialogRoot as Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
