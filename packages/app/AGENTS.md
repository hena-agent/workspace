## Priorities

- Prioritise, in this order: stability, simplicity, performance.
- Before changing session or timeline code, record a production benchmark baseline and compare it after the change.

## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- The `serve`/`web` CLI commands start V3, not the legacy App in `packages/app`. They are not the backend for root `dev:web`; without an app-v3 build, legacy URLs can return the SPA fallback `app-v3 is not built`.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from the repo root or `packages/hena`): `bun run dev:server`. This dev-only legacy listener binds to `127.0.0.1:4096` and preserves inherited authentication settings. Use `bun run dev:server --port <free-port>` for an alternate port; never stop an existing server to free its port.
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
