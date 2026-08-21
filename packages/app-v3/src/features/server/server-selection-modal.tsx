import { useState, type FormEvent } from "react"
import { CheckIcon, PlusIcon, ServerIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { Connection } from "@/lib/types"
import { ConnectionStatusDot } from "@/shell/connection-status-dot"
import { useMockServers } from "./mock-server-provider"

export function ServerSelectionModal({
  current,
  pendingUrl,
  onSelect,
}: {
  current?: Connection
  pendingUrl?: string
  onSelect: (server: Connection) => void
}) {
  const servers = useMockServers()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(pendingUrl ?? "")
  const [error, setError] = useState("")
  const status = servers.connections.some((server) => server.status === "offline")
    ? "offline"
    : servers.connections.some((server) => server.status === "connecting")
      ? "connecting"
      : servers.connections.length
        ? "online"
        : undefined

  function changeOpen(next: boolean) {
    if (next && pendingUrl) {
      setUrl(pendingUrl)
      setError("")
    }
    setOpen(next)
  }

  function select(server: Connection) {
    onSelect(server)
    setOpen(false)
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const server = servers.addServer(url)
    if (!server) {
      setError("Enter an HTTP or HTTPS server URL allowed from this origin.")
      return
    }
    setUrl("")
    setError("")
    select(server)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Manage servers">
          <span className="relative">
            <ServerIcon />
            {status ? (
              <ConnectionStatusDot
                status={status}
                className="absolute -right-1 -bottom-1 size-1.5 ring-2 ring-background"
              />
            ) : null}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Servers</DialogTitle>
          <DialogDescription>Select the mock server this window connects to.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          {servers.connections.map((server) => (
            <Button
              key={server.id}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start px-2 py-2.5"
              aria-pressed={server.id === current?.id}
              disabled={server.status === "offline"}
              onClick={() => select(server)}
            >
              <ConnectionStatusDot status={server.status} />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="truncate">{server.name}</span>
                <span className="max-w-full truncate text-xs font-normal text-muted-foreground">{server.url}</span>
              </span>
              {server.id === current?.id ? <CheckIcon data-icon="inline-end" /> : null}
            </Button>
          ))}
        </div>

        <Separator />

        <form onSubmit={add} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="server-url">Add a mock server</FieldLabel>
              <Input
                id="server-url"
                name="server-url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://server.example.com"
                value={url}
                aria-invalid={Boolean(error)}
                onChange={(event) => {
                  setUrl(event.target.value)
                  setError("")
                }}
              />
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={!url.trim()}>
              <PlusIcon data-icon="inline-start" />
              Add server
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
