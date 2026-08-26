import { useState, type FormEvent } from "react"
import { FolderPlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function AddProjectModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (directory: string) => Promise<void>
}) {
  const [path, setPath] = useState("")
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  function changeOpen(next: boolean) {
    if (next) {
      setPath("")
      setError(undefined)
    }
    onOpenChange(next)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const directory = path.trim()
    if (!directory || pending) return
    setError(undefined)
    setPending(true)
    void onSubmit(directory)
      .then(() => onOpenChange(false), (cause) => {
        setError(cause instanceof Error ? cause.message : "The directory could not be opened.")
      })
      .finally(() => setPending(false))
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open project</DialogTitle>
          <DialogDescription>Enter the absolute path to a directory on the connected server.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={Boolean(error)} data-disabled={pending}>
              <FieldLabel htmlFor="project-directory">Directory path</FieldLabel>
              <Input
                id="project-directory"
                name="project-directory"
                autoComplete="off"
                spellCheck={false}
                placeholder="~/code/my-project"
                value={path}
                disabled={pending}
                aria-invalid={Boolean(error)}
                onChange={(event) => {
                  setPath(event.target.value)
                  setError(undefined)
                }}
              />
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={!path.trim() || pending}>
              <FolderPlusIcon data-icon="inline-start" />
              {pending ? "Opening project..." : "Open project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
