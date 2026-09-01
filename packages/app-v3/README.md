# React + TypeScript + Vite + shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Development

Run `bun run dev:v3` from the repository root to start Vite and server-v3 together with hot reload.
Portless prints local and tailnet URLs for the app. It assigns loopback ports to this worktree and Vite proxies `/api`
to server-v3 on its paired loopback port. Run `bun run dev:v3:local` for the fixed `5173/4106` pair when Tailscale
sharing is not needed.

Portless asks Tailscale for the first free HTTPS port. If `443` and `8443` are occupied, the URL is:

```text
https://chris-mini.pug-mohs.ts.net:8444
```

## Custom development hosts

Set `HENA_VITE_ALLOWED_HOSTS` to a comma-separated list of exact hostnames when accessing the Vite
development server directly through Tailscale:

```bash
HENA_VITE_ALLOWED_HOSTS=workstation.example.ts.net bun run dev --host 0.0.0.0
```

Pass the same environment variable to server-v3 so it accepts `http://<host>:5173` from those hosts.
For a reverse proxy, add the complete browser origin, such as `https://app.example.com`, to the server's
`server.cors` configuration. Keeping explicit lists preserves Vite's Host-header protection.

## Generated component catalogs

`src/components/ui`, `src/components/ai-elements`, and the supporting `src/hooks/use-mobile.ts` hook are
generated source. Do not edit them by hand or with automated fixes.

The current snapshot was imported on 2026-08-26 from:

- shadcn/ui using CLI version `4.16.2` and the checked-in `components.json` (`radix-nova`)
- AI Elements using `https://elements.ai-sdk.dev/api/registry/all.json` with SHA-256
  `44b245e5633218ee36eb057f6edaf4979bbde1aafc0c51aae9f16b0a47e244d0`

For an approved catalog refresh, start from a clean worktree and run these commands from `packages/app-v3`:

```bash
bunx --bun shadcn@4.16.2 add --all --overwrite
bunx --bun shadcn@4.16.2 add https://elements.ai-sdk.dev/api/registry/all.json --overwrite
```

Review the generated diff and dependency changes, then run the package typecheck, tests, and build. The generated
component CI guard intentionally rejects catalog changes, so a refresh also requires a separately reviewed guard
policy change.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```
