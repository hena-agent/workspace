import { useState, type FormEvent } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { PlusIcon, ServerIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useServers } from "@/connection/provider"

export const Route = createFileRoute("/connect")({
  component: ConnectRoute,
})

function ConnectRoute() {
  const navigate = useNavigate()
  const servers = useServers()
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await servers.addServer(url)
    if (!result.connection) {
      setError(result.probe.message)
      return
    }
    void navigate({
      to: "/$connectionId",
      params: { connectionId: servers.getSlug(result.connection) },
      replace: true,
    })
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--legacy-background-base)] p-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--legacy-border-weak)] bg-background p-6 shadow-sm">
        <ServerIcon className="mb-8 size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Connect to Hena</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This profile belongs to <code className="text-foreground">{servers.profileOrigin}</code>.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {servers.profileOrigin.startsWith("http://")
            ? "HTTPS, this origin, and loopback HTTP servers are supported."
            : "This hosted profile accepts HTTPS servers only."}
        </p>

        <form onSubmit={(event) => void add(event)} className="mt-8 flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="connect-server-url">Server URL</FieldLabel>
              <Input
                id="connect-server-url"
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
          <Button type="submit" disabled={!url.trim()}>
            <PlusIcon data-icon="inline-start" />
            Add server
          </Button>
        </form>
      </div>
    </main>
  )
}
