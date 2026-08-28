# Codebase reduction plan

## Goal

Remove code that Hena does not plan to maintain while preserving the current product during the app-v3 and server-v3 migration.

The destination stack is:

- `packages/app-v3` for the React client
- `packages/server-v3` for HTTP, synchronization, and static serving
- `packages/core` for session execution, tools, permissions, and persistence
- `packages/schema` for shared domain data
- `packages/llm`, `packages/effect-drizzle-sqlite`, and `packages/http-recorder` as core runtime dependencies

This cleanup does not perform the v3 cutover. It removes unrelated cloud products, documentation sites, and terminal UI code first.

## Decisions

- Keep `packages/hena`, including its V1 engine, MCP, LSP, ACP, formatters, and non-TUI commands.
- Remove both terminal interfaces: `packages/tui` and the `--mini` interactive mode in `packages/hena`.
- Make bare `hena` run `hena serve`.
- Delete `packages/cli`, whose default command is the TUI.
- Delete the `/tui` HTTP API and its schema and plugin types.
- Keep `packages/app`, `packages/session-ui`, `packages/ui`, `packages/desktop`, and `packages/storybook` until app-v3 reaches parity.
- Keep `packages/server`, `packages/protocol`, `packages/client`, `packages/sdk/js`, `packages/sdk-next`, and `packages/httpapi-codegen` until the v3 cutover.
- Keep release and distribution tooling, then retarget it when server-v3 becomes the shipped server.
- Keep download statistics tooling. `script/stats.ts` and `STATS.md` are unrelated to `packages/stats`.
- Keep `.hena/glossary` and `script/translate-app.ts`; they support the legacy app and desktop packages that remain.

## Stack

The work is one stack with three branches:

```text
(develop) <- remove-cloud-infra <- remove-docs <- remove-tui
```

Each branch must typecheck and pass knip independently.

## Progress

- [x] Explore package dependencies and confirm the deletion boundaries.
- [x] Record the agreed scope in this document.
- [x] Remove cloud packages and SST infrastructure.
- [x] Remove both documentation sites and repair references.
- [x] Remove the TUI package, mini UI, TUI API, and OpenTUI dependencies.
- [x] Regenerate affected SDK output.
- [x] Run package tests, typechecks, lint, knip, builds, and HTTP API checks.
- [x] Submit the three stacked pull requests.

Update this checklist after each branch is committed and verified. If work resumes after context compaction, read this file and inspect `gh stack view --json`, `git status`, and the checklist before making changes.

## Branch 1: remove cloud infrastructure

### Delete

- `packages/console/app`
- `packages/console/core`
- `packages/console/function`
- `packages/console/mail`
- `packages/console/resource`
- `packages/console/support`
- `packages/stats/app`
- `packages/stats/core`
- `packages/stats/server`
- `packages/enterprise`
- `packages/function`
- `packages/slack`
- `packages/containers`
- `packages/identity`
- `infra`
- `sst.config.ts`
- the root `sst-env.d.ts`
- generated `sst-env.d.ts` stubs in retained packages
- `packages/app/src/sst-env.d.ts`; replace its Vite ambient type reference with `packages/app/src/vite-env.d.ts`
- `patches/@standard-community%2Fstandard-openapi@0.2.9.patch`
- the orphaned root `screenshot-uk.png`

### Root configuration

Edit `package.json`:

- Remove `dev:console`, `dev:stats`, and `sso`.
- Remove the `packages/console/*`, `packages/stats/*`, and redundant `packages/slack` workspace entries.
- Remove catalog entries used only by deleted packages: `@cloudflare/workers-types`, `@openauthjs/openauth`, `hono-openapi`, `sst`, and `@solidjs/start`.
- Remove root development dependencies `@cloudflare/workers-types` and `sst`.
- Remove overrides for `@cloudflare/vite-plugin` and `vite-plugin-node-polyfills`.
- Remove the `@standard-community/standard-openapi` patch registration.
- Keep `hono` and `@hono/standard-validator`; server-v3 uses them.
- Keep `dev:web`; it starts the retained legacy app.

Edit `knip.jsonc`:

- Remove `infra` and container entry and project globs.
- Remove `ulimit` from ignored binaries after `dev:console` is gone.
- Remove workspace blocks for the deleted console, stats, web infrastructure, enterprise, and function packages.
- Preserve entries for retained publish scripts and generated clients.

Remove stale `.sst`, `.wrangler`, and `sst-env.d.ts` references from lint, format, Git, and Docker ignore files when they no longer describe generated files.

### Runtime consequences

No retained package imports a deleted cloud package. Several retained CLI features call hosted URLs rather than workspace code:

- `hena github install` calls `api.hena.dev/get_github_app_installation`, implemented only by the deleted `packages/function` worker.
- `hena console` calls the deleted console service.
- sharing and Go upsell messages call deleted hosted routes.
- the legacy web server falls back to `app.hena.dev` when the embedded UI is absent.
- curl-based upgrades fetch `hena.dev/install`.

Keep these call sites in this branch to avoid mixing product behavior changes with package deletion. Document the broken hosted dependencies in the PR. The embedded legacy app remains functional.

Keep `packages/core/src/share/sql.ts` and `packages/core/src/account/sql.ts`. They remain imported and deleting their tables would require a database migration.

### Verification

```sh
bun install
bun run knip
bun turbo typecheck --concurrency=1
bun run lint
```

Run tests from package directories, never from the repository root.

## Branch 2: remove docs

### Delete

- `packages/web`, the Astro and Starlight documentation site
- `packages/docs`, the Mintlify tree

### Repair references

- Remove the `packages/web` workspace block from `knip.jsonc` if it was not already removed on the lower branch.
- Remove the stale `packages/web` commit-prefix instruction from `.hena/command/commit.md`.
- Replace or remove image references in translated root README files that point into deleted console and web packages.
- Update `packages/desktop/scripts/copy-metainfo.ts`, whose AppStream screenshot URL points at `packages/web`.
- Keep `packages/sdk/openapi.json`; `packages/docs/openapi.json` was only a symlink to it.

After cloud and docs deletion, `packages/hena/script/schema.ts` has no publishing caller. Keep config schema generation for now because Hena still writes `https://hena.dev/config.json` into user configuration. The TUI branch removes its obsolete `tui.json` output.

### Verification

```sh
bun install
bun run knip
bun turbo typecheck --concurrency=1
bun run lint
```

## Branch 3: remove terminal UI

This branch removes about 50,000 lines of terminal UI implementation plus tests and generated API output.

### Remove the `/tui` HTTP API

Delete:

- `packages/hena/src/server/routes/instance/httpapi/groups/tui.ts`
- `packages/hena/src/server/routes/instance/httpapi/handlers/tui.ts`
- `packages/hena/src/server/shared/tui-control.ts`
- `packages/hena/src/util/queue.ts` if it has no remaining importer
- `packages/hena/src/server/tui-event.ts`
- `packages/schema/src/tui-event.ts`
- `packages/plugin/src/tui.ts`
- TUI route and HTTP API exercise tests

Remove group and handler registration from the Hena HTTP API. Remove `TuiEvent` from the schema event manifest and remove the `./tui` plugin export and OpenTUI peer dependencies.

`packages/client` and `packages/protocol` require no changes because the TUI routes were never part of their contract.

`packages/hena/src/mcp/index.ts` uses `TuiEvent.ToastShow` for OAuth errors. Replace that with a generic notification event or remove those publishes. Do not retain a TUI-named schema solely for two notification calls.

The VS Code extension calls `POST /tui/append-prompt`. Remove or replace that command flow because bare `hena` will start a server rather than a terminal interface.

Regenerate the JavaScript SDK and OpenAPI files rather than editing generated files directly:

```sh
./packages/sdk/js/script/build.ts
```

### Remove interactive `hena run`

Keep the non-interactive `hena run` path. It reaches only these files in `packages/hena/src/cli/cmd/run`:

- `tool.ts`
- `types.ts`

Delete the other 35 files. Remove `--mini`, `--interactive`, `--replay`, `--replay-limit`, and `--demo` from `run.ts`, along with `runMini` and interactive branches. Trim interactive-only exports from `tool.ts` and `types.ts`.

Keep `packages/hena/test/cli/run/run-process.test.ts`; it covers non-interactive output, JSON mode, tool events, permission rejection, and interruption. Delete tests that exercise the removed footer, scrollback, theme, prompt, replay, and interactive runtime.

### Move shared utilities out of the TUI package

Several Hena modules re-export generic helpers from `@hena/tui`:

- Move the used error formatting functions into `packages/hena/src/util/error.ts`.
- Inline `isRecord` in `packages/hena/src/util/record.ts`.
- Move only the used locale functions into `packages/hena/src/util/locale.ts`.
- Inline the retained ASCII logo in `packages/hena/src/cli/ui.ts`.
- Delete `packages/hena/src/cli/cmd/prompt-display.ts`; only the terminal UI imports it.
- Delete `packages/hena/parsers-config.ts`; it has no importer.
- Preserve the non-TUI session validation used by HTTP API tests by moving or inlining `src/cli/tui/validate-session.ts`.

### Delete packages and OpenTUI tooling

Delete:

- `packages/tui`
- `packages/cli`
- `packages/hena/src/cli/cmd/tui.ts`
- `packages/hena/src/cli/tui`
- `packages/hena/src/plugin/tui`
- `packages/hena/src/config/tui.ts`
- `packages/hena/src/config/tui-migrate.ts`
- `packages/hena/src/config/tui-host-attention.ts`
- `packages/hena/src/config/tui-cwd.ts`
- TUI test fixtures and TUI plugin tests
- `.hena/tui.json`
- `.hena/plugins/tui-smoke.tsx`
- `script/upgrade-opentui.ts`

Remove:

- OpenTUI preloads from `packages/hena/bunfig.toml`
- JSX and OpenTUI compiler settings from `packages/hena/tsconfig.json`
- OpenTUI build plugins, parser worker embedding, worker entrypoints, and defines from `packages/hena/script/build.ts`
- `@hena/tui`, `@opentui/*`, `opentui-spinner`, and Hena's now-unused `solid-js` dependency
- root OpenTUI catalog entries, development dependencies, overrides, minimum-age exceptions, and upgrade script
- TUI and preview CLI entries from `knip.jsonc`, `turbo.json`, `.github/workflows/test.yml`, and `script/publish.ts`
- TUI schema generation from `packages/hena/script/schema.ts`

Keep the shared root `solid-js` catalog entry because the retained web and desktop packages use it.

Keep the accepted `PluginKind` value `"tui"` temporarily if removing it creates unrelated plugin migration work. It can remain inert until external plugin compatibility is handled separately.

### Change the default command

Replace the `$0` TUI command with the existing serve handler. Bare `hena` must behave like `hena serve`.

Remove TUI and mini modes from `hena attach`. Delete the command if it has no useful non-TUI behavior after those modes are removed.

Regenerate help snapshots.

### Verification

```sh
bun install
bun run knip
bun turbo typecheck --concurrency=1
bun run lint
```

From `packages/hena`:

```sh
bun test
bun run test:httpapi:coverage --fail-on-missing
bun run test:httpapi:auth
bun run test:httpapi:effect
bun run script/build.ts
```

From other affected package directories:

```sh
bun test
bun typecheck
```

Run app and server builds for both retained UI stacks, then smoke-test:

- bare `hena` starts the server
- `hena run` remains non-interactive
- the embedded legacy web app still serves
- app-v3 connects to server-v3

## Later work

These changes are outside this stack:

- Cut `packages/hena` over to server-v3 and app-v3.
- Delete the retained legacy app, desktop, UI, server, protocol, client, and SDK packages after parity.
- Move SDK-derived domain types used by core and plugin into `@hena/schema` before deleting `packages/sdk/js`.
- Retarget publishing, installers, GitHub Action, and VS Code integration to server-v3.
- Rebrand or preserve `@opencode-ai/plugin` based on external compatibility requirements.
- Decide whether to remove multilingual root README files and old download statistics.
