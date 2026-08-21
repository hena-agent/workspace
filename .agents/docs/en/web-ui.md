# Web UI V3

Specification for the rewrite of Hena's Web UI, shared by the browser PWA and the Electron desktop shell.

Status: provisional design. Milestone 0 is a blocking validation phase; this document becomes approved only when its exit gates pass and measured results are recorded here.

Supersedes at stable cutover: `packages/app` (SolidJS) and `packages/session-ui`.

---

## 1. Scope and principles

### 1.1 Purpose

`packages/app` has accumulated two parallel layouts, very large shell and Session components, a hand-written SSE reducer, and a per-directory context/ref-count system. It has no durable offline mutation path or service worker. V3 replaces its presentation and data layers with React and a local database.

The governing idea is narrower than "the network is never on the interaction path":

- Cached reads render without an API round trip.
- Mutations explicitly classified as queueable commit to a durable local outbox before the UI reports them as accepted.
- Security-sensitive, destructive, ephemeral, and secret-bearing operations remain online-only.
- Network, synchronization, and durability are separate states and are shown separately when relevant.
- The server remains authoritative for synchronized data; unsent drafts and queued intent remain client-owned data and are never discarded by a cache reset.

### 1.2 Product principles

- **Modern, clean, fast.** Linear-grade density with restrained motion.
- **Local-first where honest.** Cold and offline starts render persisted data; unavailable online-only features say why.
- **Durable acknowledgement.** "Queued" means the operation survived a successful outbox commit.
- **Mobile-first PWA.** Designed for a phone and adapted upward.
- **Failure is visible and local.** No telemetry is required to understand sync, outbox, migration, or rendering failures.
- **One product across runtimes.** Browser and Electron share application code, while capability and security differences stay explicit.

### 1.3 Non-goals

- Background Web Push while the PWA is suspended
- Message-content full-text search
- QR pairing or tunnel provisioning
- Application tabs or multi-Session keep-alive
- Full RTL layout in the first stable release; see the Arabic support restriction in §9.3
- Phone terminals
- A cross-server Inbox; every route answers to the one server its URL names (§8.1)
- The packaged Electron origin in the first release (§3.4)
- Migrating V2 connection records or credentials (§10.5)

### 1.4 Stack

React 19 with React Compiler, Vite, TanStack Router, TanStack DB, TanStack Query, TanStack Virtual, Tailwind CSS v4, shadcn/Radix, Streamdown with `@streamdown/code`, and `@pierre/diffs`. HTTP calls use the generated Promise client from `@hena/client`; tier-2 and tier-3 fetchers and every outbox mutation call it rather than hand-written `fetch` wrappers, so protocol changes surface as type errors after `bun run generate`.

The Milestone 2 terminal reuses V2's `ghostty-web`. It is a Git dependency rather than a registry release, so it is pinned by commit, excluded from the initial shell, and gated by validation item 8 in §14.

The candidate persistence set validated in Milestone 0 is pinned exactly, not with `x` ranges:

| Package                                   | Candidate version |
| ----------------------------------------- | ----------------- |
| `@tanstack/db`                            | `0.6.17`          |
| `@tanstack/react-db`                      | `0.1.95`          |
| `@tanstack/db-sqlite-persistence-core`    | `0.2.9`           |
| `@tanstack/browser-db-sqlite-persistence` | `0.2.9`           |
| `@journeyapps/wa-sqlite`                  | `1.4.1`           |
| `@tanstack/offline-transactions`          | `1.0.42`          |

These are an audited compatibility set, not a permanent promise. Changing any member reruns the Milestone 0 persistence, outbox, bundle, and multi-tab gates before merge.

### 1.5 Scaffold

Create the initial project outside the repository with:

```sh
bunx --bun shadcn@<pinned-cli-version> init --preset bIkeymG --template vite
```

Pin the exact CLI version rather than `@latest`, and record both it and the resolved preset payload under validation item 1 in §14. `--preset` is a short code that the CLI resolves against a remote service, so the same code can produce different output later; the recorded payload, not the code, is the reproducible artifact.

Migrate it into `packages/app-v3`. Preserve `components.json`, path aliases, CSS-first Tailwind wiring, and the shadcn file layout so `shadcn add` remains usable. Generated component source is owned by this repository and may be adapted for accessibility, density, and themes; "preserve" does not mean the component files are immutable.

Replace scaffold tooling with the repository's oxlint, Prettier, `tsc`, Bun, Playwright, and Turborepo setup.

---

## 2. Decision summary

| Area                  | Decision                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Sync transport        | One fetch-based SSE connection per configured server                                         |
| Stream control        | Authenticated server-issued stream resource with revisioned desired subscriptions            |
| Server change feed    | Transactional `collection_change` log with `{ feedId, seq }` cursors                         |
| Snapshot handoff      | Scoped replacement snapshot at a captured watermark, followed by buffered live rows          |
| Mutation confirmation | Durable transaction receipt, not first-row txid observation                                  |
| Location scoping      | Instance-wide list collections; Session transcripts subscribe by scope                       |
| Multi-server          | One isolated connection agent, outbox namespace, and trust boundary per connection           |
| Server liveness       | Every registered server stays live; the URL slug names the focused one                       |
| Connection identity   | The canonical base URL is the identity; there is no separate connection UUID                 |
| Credentials           | Revocable server-issued device token; the password is never persisted                        |
| Streaming text        | Ordered ephemeral deltas outside TanStack DB; finalized rows remain authoritative            |
| Persistence           | SQLite in OPFS through TanStack persistence, subject to Milestone 0 gates                    |
| Multi-tab             | One connection/database leader plus tab subscription claims and relay                        |
| Offline writes        | Explicit mutation allowlist through one isolated executor per server                         |
| HTTP client           | Generated Promise client from `@hena/client`                                                 |
| Runtime validation    | Bounded protocol validation at network and IPC trust boundaries                              |
| Routing               | TanStack Router file routes with non-blocking data loading                                   |
| URL scheme            | Server slug first on every route: base64url of the canonical base URL                        |
| Tabs                  | None; project rail, Session list, and one content pane                                       |
| Connection control    | Top-right titlebar control opens one server-management surface, also mounted in Settings     |
| Timeline              | Virtualized stable history plus an unvirtualized live tail and reader mode                   |
| Markdown              | Streamdown plus `@streamdown/code`, with raw HTML disabled                                   |
| Diffs                 | `@pierre/diffs/react` with explicit worker-pool wiring                                       |
| Composer              | Native textarea with an inaccessible highlight mirror                                        |
| Theming               | Small curated theme set on native shadcn tokens                                              |
| Density               | Coarse-safe capability queries plus an optional user preference                              |
| i18n                  | Existing dictionaries and a typed custom hook; Arabic strings are beta until RTL ships       |
| PWA                   | Versioned app-shell precache and explicit navigation/update behavior                         |
| Notifications         | Permissioned local notifications with one elected notifier                                   |
| Connectivity          | Manual server entry; transport rules differ per origin class and are stated per class        |
| Hosting               | Origin is the profile boundary; hosted `app.hena.dev` and server-embedded are separate installs |
| Desktop               | Versioned, runtime-validated `window.hena` capability bridge replacing `window.api`          |
| Testing               | Bun/RTL, Playwright, protocol conformance, migration, security, and packaged desktop tests   |
| Error handling        | App, route, and part boundaries; local redacted diagnostics only                             |
| Delivery              | No preview channel; V3 takes `app.hena.dev` and the embed slot in one change                 |

---

## 3. Package and delivery

### 3.1 Package

The package is `packages/app-v3`, named `@hena/app-v3`. React components remain in this package: shadcn primitives under `src/components/ui` and product components in feature folders. Do not create a shared React design-system package before a second consumer exists.

Cross-package tooling comes from the root `workspaces.catalog`. React-only runtime dependencies are exact dependencies of `packages/app-v3`.

Vite must exclude the audited SQLite packages from dependency optimization and serve WASM with the correct MIME type. Persistence is loaded through a narrow dynamic import after first shell paint. Dev, production, service-worker, and packaged Electron builds all use the same tested worker/WASM locator.

### 3.2 Release model

There is no stable runtime toggle and no release containing both UI bundles. There is also **no preview channel and no second hostname**: V3 does not get a `v3.hena.dev`, and no artifact carries both UIs selectable at runtime. V3 replaces V2 at `https://app.hena.dev` and in the server's embed slot in the same change, and that change is gated on §12.4.

That single change does all of the following together, because any subset leaves the two UIs contradicting each other:

- The `sst.cloudflare.StaticSite("WebApp")` resource in `infra/app.ts` is deleted and `app.hena.dev` is served by `packages/app-v3`'s own `wrangler.jsonc` (§3.5).
- `createEmbeddedWebUIBundle` in `packages/hena/script/build.ts` builds `packages/app-v3` instead of `packages/app`.
- The proxy fallback in `packages/hena/src/server/shared/ui.ts` is deleted along with `UI_UPSTREAM` (§3.4).
- `packages/desktop` is on the built V3 renderer artifact and `packages/app` is deleted, per the disposition table below.

Because there is no preview channel, §12.4's gate list is the only thing standing between V3 and every user. Its "preview-channel feedback window" line is removed and not replaced; the remaining gates tighten rather than relax.

V2 UI code is not a single package, and deletion order is a gate, not an afterthought. Each dependent package has an explicit disposition that must be complete before the package it depends on is removed:

| Package               | Depends on today               | Disposition at cutover                                                                     |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `packages/app`        | `@hena/session-ui`, `@hena/ui` | Deleted                                                                                    |
| `packages/session-ui` | `@hena/ui`                     | Deleted only after `enterprise` and `storybook` no longer import it                        |
| `packages/enterprise` | `@hena/session-ui`, `@hena/ui` | Share viewer (`src/routes/share/[shareID].tsx`) migrates off `@hena/session-ui` first      |
| `packages/storybook`  | `@hena/session-ui`, `@hena/ui` | Session-UI stories retarget V3 components or are removed with the package they documented  |
| `packages/desktop`    | `@hena/app`                    | Switches to the built V3 renderer artifact (§10.2) before `packages/app` is deleted        |
| `packages/ui`         | -                              | Retained for remaining SolidJS consumers; V3 does not use it or its `--v2-*` tokens (§9.1) |

The share viewer is the only V2 surface V3 does not replace; §8.11 defines that split. A cutover change that deletes `packages/session-ui` while `packages/enterprise` still imports it does not build, so the disposition table is part of the §12.4 gate.

Rollback means redeploying or reinstalling the complete previous application artifact, not merely changing a renderer asset. Before rollback, V3 must drain pending work or export it as human-readable drafts. V3 storage namespaces are disjoint from every namespace a V2 build reads or writes, so a downgraded application cannot observe or delete V3 outbox records; this is an obligation on V3's namespace choice, not a requirement placed on already-shipped code. Browser rollback includes the service-worker and cache version.

Desktop rollback reinstalls the previous application and server binary. It never restores an older server database over a newer one, because Sessions created after the upgrade would be lost. If a server schema migration is not backward compatible, the runbook defines an explicit, user-visible export step instead of a silent database swap.

### 3.3 Compatibility policy

Every connection performs capability negotiation before collection sync. During development the protocol may require exact compatibility. Before stable cutover, the release notes must state the supported client/server window and behavior for an unsupported server.

An unsupported connection enters `upgrade_required`; it does not open an outbox, mutate persisted rows, or retry indefinitely. Other compatible servers continue working.

### 3.4 Hosting and origins

V2 serves its UI two ways from the same server process: an embedded build, or a proxy to a hosted upstream when no build is embedded (`packages/hena/src/server/shared/ui.ts`). V3 keeps the embedded build and **deletes the proxy**. This is a normative constraint, not an implementation detail, because every durable client concept in this document is scoped to a browser origin.

**An origin is a profile boundary.** The OPFS database, service worker and its precache, install identity, notification permission, connection list, credentials, drafts, and outboxes all belong to exactly one origin. Two origins are two independent installs of the same product, even when they talk to the same servers.

V3 ships to two origin classes. The packaged Electron origin is deferred with the rest of §10.2 and is not part of the first V3 release.

| Origin                       | Profile                                     | App version controlled by | Deferred |
| ---------------------------- | ------------------------------------------- | ------------------------- | -------- |
| Hosted `app.hena.dev`        | One profile shared across all added servers | The CF deployment (§3.5)  | no       |
| Server-embedded (per server) | One profile per server origin               | That server's artifact    | no       |
| Packaged Electron            | One profile per installation                | The desktop artifact      | yes      |

Consequences that the implementation and the UI must honor:

- A profile opened from server A's origin may add servers B and C, but its data lives under A's origin. Opening B's origin later is a different profile with an empty connection list, and the UI says so rather than implying data loss.
- On a server-embedded origin, the serving server also controls the app version, so §3.3's compatibility window governs the _other_ servers that profile connects to. A server-embedded profile can therefore be forced to upgrade by the server it was loaded from.
- The service-worker update flow in §10.1 and rollback in §3.2 are per origin. A rollback on one server origin does not downgrade another profile.
- Cross-origin requirements in §5.6 apply to every server that is not the serving origin, including the hosted-origin case where every server is cross-origin.
- **Transport rules differ per origin class** and are stated per class in §10.3. They are not one global law, because a page served from `http://localhost:4096` reaching its own server is same-origin with no mixed content, no CORS preflight, and no Local Network Access check, while the hosted origin is cross-origin to everything.

The connect surface and Settings show which origin the current profile belongs to, because "why are my servers missing" is otherwise indistinguishable from data loss.

#### The server serves its own artifact

`serveUIEffect` loses its upstream branch entirely; `UI_UPSTREAM`, `upstreamURL`, and the proxy response-header handling are deleted. A built binary serves its embedded bundle. A server running from source serves `packages/app-v3/dist` from disk, and when that directory is absent it returns a plain instruction to run the app build rather than silently serving someone else's UI.

This makes §3.4's "that server's artifact controls the version" literally true, removes the class of bug where a CF deploy changes the UI of every running server, and fixes the long-standing behavior documented in `packages/app/AGENTS.md` where local UI edits are invisible under `hena dev web`. The cost is one build step before `hena dev web` works, and that is stated in the dev docs rather than worked around.

#### A stable port is a requirement, not a preference

`hena serve` currently defaults to port `0`, meaning "try 4096, else any free port" (`packages/hena/src/server/server.ts`). Under §6.2 the address is the connection identity, and on the embedded origin the address is also the **browser origin**. A silent port fallback therefore does not merely rename a connection; it moves the entire profile — localStorage, the registry, the device token, drafts, and outboxes — to a partition the previous profile cannot reach. No client-side canonicalization can recover it, because the browser partitioned storage before any response arrived.

The silent fallback is removed. If the default port is unavailable and no `--port` was given, `hena serve` fails with an explicit message naming the conflict and the flag. A user who chooses a port keeps their profile permanently; a user who does not is told why up front instead of discovering an empty app later.

### 3.5 Hosted deployment

`packages/app-v3` owns its own `wrangler.jsonc` and deploys to Cloudflare Workers Static Assets, independent of `sst.config.ts`. Static assets are the whole product: there is no server-side rendering, no API worker, and no origin logic.

- `assets.not_found_handling` is `single-page-application`, because every route begins with a base64url slug that no static file matches.
- Response headers come from `_headers`; on a static host there is no server to add them. The header classes are the same ones the embedded origin must send (§10.1), so both origins are described once and tested once.
- The origin is `app.hena.dev` and nothing else. That hostname already matches the server's built-in CORS allowlist (`packages/server/src/cors.ts`), so every already-shipped Hena server accepts the hosted app with no flag, no config change, and no upgrade. Choosing any other hostname would require every user to pass `--cors`, and a forgotten flag is indistinguishable from an opaque network failure.

---

## 4. Data model contracts

### 4.1 Collection manifest

The protocol owns a generated manifest for every synchronized collection. The manifest defines the public row schema, authority scope, canonical key fields, durability, snapshot source, row revision, bounded fields, and deletion behavior. Changelog rows contain public DTOs, never raw database rows or internal catalog objects.

Minimum catalog:

| Collection       | Scope          | Durability               | Canonical key                                 |
| ---------------- | -------------- | ------------------------ | --------------------------------------------- |
| `projects`       | instance       | durable/derived snapshot | project ID                                    |
| `locations`      | instance       | derived                  | Location key                                  |
| `sessions`       | instance       | durable                  | Session ID                                    |
| `sessionInputs`  | Session        | durable                  | admitted message ID                           |
| `messages`       | Session        | durable                  | message ID                                    |
| `parts`          | Session        | durable                  | owning message ID + content kind + content ID |
| `todos`          | Session        | durable                  | Session ID + server-issued todo ID            |
| `permissions`    | server runtime | volatile                 | request ID                                    |
| `questions`      | server runtime | volatile                 | request ID                                    |
| `agents`         | Location       | derived                  | Location key + agent name                     |
| `models`         | Location       | derived                  | Location key + provider ID + model ID         |
| `providers`      | Location       | derived                  | Location key + provider ID                    |
| `serverCommands` | Location       | derived                  | Location key + command name                   |
| `skills`         | Location       | derived                  | Location key + skill name                     |
| `mcpServers`     | Location       | derived                  | Location key + MCP name                       |
| `integrations`   | Location       | derived                  | Location key + integration ID                 |
| `sessionDiffs`   | Session        | durable bounded summary  | Session ID + file path                        |
| `ptys`           | server runtime | volatile                 | PTY ID                                        |

`Location key` is a canonical encoding of the complete `Location.Ref`, including `workspaceID` when present. `locations` exists so the client can enumerate the Location keys a server exposes; without it, seven Location-scoped collections have keys the client cannot discover or render.

A client storage key is the tuple `(connection identity, collection, manifest key)`, where the connection identity is the canonical base URL defined in §6.2. The manifest key is frequently composite, so no code may assume a single `id` field or flatten identity into a `${serverId}:${id}` string.

#### Message model

The manifest projects the V2 message model in `packages/schema/src/session-message.ts`, not the v1 `Message` + `Part` model in `packages/schema/src/v1/session.ts`. The two differ in ways that change collection design, so the choice is normative:

- `messages` rows cover the whole `Session.Message` union: `user`, `assistant`, `compaction`, `shell`, `system`, `synthetic`, `agent-switched`, and `model-switched`.
- User content is fields on the user message row (`text`, `files`, `agents`), not part rows. The `parts` collection holds assistant content only.
- `parts` rows correspond to `AssistantContent`, whose kinds are `text`, `reasoning`, and `tool`. Content IDs are unconstrained provider strings on three separate content types, so they are not unique on their own; the key includes the kind for that reason, and the manifest must not "simplify" it away.
- A compaction message streams its `summary` before the row is final, and `summary` is a field on the compaction message row rather than a part. It therefore has no sub-part identity: its delta target is the compaction message ID with kind `compaction` and a content ID equal to the message ID, and finalization commits the `messages` row, not a `parts` row.
- `shell` messages carry `command` and `output` on the message row and obey the tool-output preview bound in §4.4.

Two collections require server work before they can be published: the server has no stable todo ID today (todos are keyed by `(session_id, position)`, which is not stable under reorder or edit), and `mcpServers` exists only on the legacy HTTP surface rather than in `packages/protocol`. Adding a durable todo ID and a V2 MCP group are Milestone 0 protocol tasks, not client-side workarounds. A client-synthesized todo ID is explicitly rejected: any client derivation from position or content breaks identity exactly when the user edits or reorders.

`sessionDiffs` is keyed by `(Session ID, file path)` with the revision carried as a row field, so a changed file updates one row instead of accumulating one row per revision. Superseded revisions have no independent lifetime and need no retention rule.

Volatile and derived collections include `runtimeId` or source revision. A changed server runtime forces a replacement snapshot so stale permission, question, PTY, active-run, and catalog rows cannot survive a restart.

### 4.2 Feed metadata and changelog

Core owns one feed metadata row and the changelog:

```sql
collection_feed(
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  feed_id        TEXT NOT NULL,
  retained_floor INTEGER NOT NULL,
  runtime_id     TEXT NOT NULL
)

collection_change(
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  collection   TEXT NOT NULL,
  scope_key    TEXT NOT NULL,
  row_key      TEXT NOT NULL,
  op           TEXT NOT NULL,       -- insert | update | delete | reset
  row          TEXT,                -- bounded public JSON DTO; null for delete/reset
  row_revision TEXT,
  txid         TEXT,
  runtime_id   TEXT,
  created_at   INTEGER NOT NULL
)
```

Add indexes required by measured queries, including `(collection, scope_key, seq)` and retention by `created_at`. `feed_id` is a random durable identifier. A database replacement or incompatible feed rebuild creates a new `feed_id`; ordinary server restart changes only `runtime_id`.

A `reset` operation applies to the whole `(collection, scope_key)` rather than to one row: `row_key` is the empty string and `row` is null. A client that receives `reset` drops every persisted key in that scope and waits for the replacement snapshot that must follow it. `row_key` is never empty for any other operation.

Every durable authoritative write and its changelog operations commit in the same SQLite transaction. Milestone 0 contains a write-path audit proving this for each manifest row. Direct writes, bulk deletes, revert commits, and projector bypasses must either emit complete operations transactionally or use a scoped `reset` followed by replacement data.

Derived and volatile sources that cannot participate in the durable transaction publish a new source revision and replacement snapshot. They are not represented as crash-durable changes they cannot guarantee.

### 4.3 Transaction receipts and idempotency

Every queueable mutation accepts:

- An operation name
- A client-generated idempotency key
- A canonical request fingerprint
- Any required expected revision

The server stores a durable idempotency record scoped by authenticated principal, operation, and key. Exact replay returns the recorded response and receipt; a different fingerprint returns `409 idempotency_conflict`.

After all synchronous authoritative changes commit, the server produces:

```ts
type TransactionReceipt = {
  txid: string
  outcome: "applied" | "noop" | "exact_retry"
  through: { feedId: string; seq: number }
  affectedScopes: Array<{ collection: string; scopeKey: string }>
}
```

The HTTP response and stream both carry the same receipt. The receipt confirms only the synchronous mutation boundary. A prompt receipt confirms Session creation/admission, never completion of model execution.

The client resolves optimistic state after it has both the receipt and authoritative state through `receipt.through`, or after a replacement snapshot proves equivalent state. Recently observed receipts are retained long enough to handle stream-before-HTTP ordering and are queryable through a bounded receipt lookup endpoint.

### 4.4 Content bounds

Every frame, row, and endpoint has an encoded byte limit. Initial defaults, adjusted only by measured protocol changes:

| Resource                      | Limit                                  |
| ----------------------------- | -------------------------------------- |
| Control request               | 64 KiB                                 |
| Operations per rows frame     | 500                                    |
| Decoded rows frame            | 1 MiB                                  |
| Per-stream queued output      | 4 MiB                                  |
| Persisted tool output preview | first of 32 KiB UTF-8 or 500 lines     |
| In-flight text/reasoning part | 2 MiB before forced finalization/error |
| Full-content page             | 256 KiB                                |
| Inlined attachment bytes      | 5 MiB per file, 20 MiB per prompt      |

Truncated rows contain `truncated`, UTF-8 byte count, line count, content revision/hash, and a non-secret content ID. Full content is authorized against the authenticated principal, owning Session, and revision on every request; its URL is not a bearer capability. It is paged or ranged, fetched with `cache: "no-store"`, and not persisted. The UI explains that uncached full content is unavailable offline.

The attachment bound needs its own explanation because the wire model is reference-based. `Prompt.FileAttachment` is `{ uri, mime, name?, description?, source? }`, so a prompt references content the server can already resolve; it does not carry uploaded bytes. That produces two different attachment paths:

- **Server-resolvable attachments** (a workspace file the user mentioned) travel as a URI. They are cheap, work offline, and are the only kind the current protocol fully supports.
- **Client-held attachments** (a file picked or pasted in a browser) have no server-side path. Until an upload endpoint exists, they are inlined as bounded data URIs within the limits above; beyond those limits the composer requires an online send and says why.

Attachment bytes live in the durable draft store keyed by content ID, never in the outbox payload, which stays bounded and holds the reference. The executor resolves bytes at flush time, so an offline prompt with an attachment survives reload. Whether V3 stable ships a real upload endpoint instead of inlining is validation item 9 in §14.

---

## 5. Collection stream protocol

### 5.1 Endpoints

```text
GET    /api/collection/capabilities
POST   /api/collection/streams
PUT    /api/collection/streams/:streamId/subscription
GET    /api/collection/streams/:streamId/events
DELETE /api/collection/streams/:streamId
GET    /api/collection/transactions/:txid
```

`GET /capabilities` is the connection handshake, and it is the only endpoint a client may call before it trusts a server or holds a credential. It answers four questions at once so that add-validation, Move verification (§6.2), and the `upgrade_required` state of §3.3 share one call instead of three heuristics:

```ts
type Capabilities = {
  feedId: string // §4.2 durable identity; proves server sameness across an address change
  protocol: { min: number; max: number }
  auth: "none" | "required" // whether a credential is needed at all
}
```

It is reachable without a credential, returns `no-store`, and carries CORS headers on every status including `401`, because a `401` without them is invisible to the browser. It exposes no Session, project, or principal data: it is a handshake, not a read.

`POST /streams` returns a cryptographically random `streamId`, a separate control token, attachment generation, expiry, feed metadata, and initial subscription revision. The resource is bound to the authenticated principal. Control requests carry the control token in a header; IDs are not bearer capabilities.

The revisioned subscription PUT supplies the complete desired state, not imperative add/remove commands:

```ts
type SubscriptionState = {
  revision: number
  lists: boolean
  sessions: string[]
  // key: `${collection}:${scopeKey}`
  cursors: Record<string, { feedId: string; seq: number }>
}
```

`lists` is a real toggle, not a constant: a window that only renders one transcript sets it to `false` and receives no instance-wide or Location-derived rows. Cursor keys are `${collection}:${scopeKey}` because a scope resumes independently even though all scopes share one server sequence space; an instance-scoped collection uses the empty scope key. Omitting a cursor requests a replacement snapshot for that scope.

The server accepts only increasing revisions and returns the accepted revision and generation. A desired state may arrive before the SSE attachment. A new attachment increments the generation and supersedes an old one; frames from an old generation are ignored. Stream resources expire after disconnect plus a bounded grace period.

List subscriptions include authorized instance-wide and Location-derived rows. Transcript subscriptions are Session-scoped. Every Session ID and full-content request is independently authorized; local filtering is never treated as access control.

### 5.2 Snapshot and live handoff

Each newly requested `(collection, scope)` follows this state machine:

1. Register a live-change buffer for the scope.
2. Open a consistent read transaction and capture `baseSeq`.
3. Emit `snapshot.begin` with `scope`, `snapshotId`, `baseSeq`, and `replace: true`.
4. Emit bounded `snapshot.page` frames from the consistent view.
5. Emit `snapshot.end` with the complete key count/hash and `throughSeq`.
6. Replay buffered operations whose sequence is greater than `throughSeq`.
7. Continue with live rows.

Every page comes from the single read transaction opened in step 2, so `throughSeq` always equals `baseSeq`. It is repeated on `snapshot.end` so the client can validate the pair; a mismatch is a protocol error rather than a case the client tries to reconcile. A snapshot is never chunked across several read transactions, because that would silently rebase the watermark the client is about to trust.

The client commits the replacement snapshot atomically for that scope, including deletion of persisted keys absent from it. A newly added Session scope always receives its own snapshot; it never inherits an instance-list cursor that may have skipped transcript changes.

A rows frame carries one or more complete server transactions in sequence order, each delimited explicitly with its own sequence range and any completed receipt. Batching may merge whole transactions; it never interleaves them and never splits one implicitly.

A transaction larger than the frame bounds in §4.4 is split across consecutive frames marked `continues: true` and terminated by a final frame for the same transaction. The client buffers those frames and publishes nothing until the terminating frame arrives, so a large revert cannot become visible half-applied. Without this rule the frame bounds and the atomic-visibility guarantee contradict each other.

Where a transaction spans collections, a client publication barrier withholds the receipt and derived application state until all affected collection commits succeed. The adapter performs those commits without yielding to a render between them, and Milestone 0 must prove that no intermediate combination is painted; inability to provide that guarantee is a blocking design failure. Cursor metadata advances only with the corresponding rows.

### 5.3 Frames

Every frame includes `protocolVersion`, `feedId`, `runtimeId`, `streamId`, `generation`, and accepted subscription revision.

| Frame            | Purpose                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `stream.ready`   | Confirms attachment, generation, and feed bounds                      |
| `snapshot.begin` | Starts a scoped replacement snapshot                                  |
| `snapshot.page`  | Sends one bounded page                                                |
| `snapshot.end`   | Completes and validates replacement                                   |
| `rows`           | Transactional row operations, cursor range, and receipts              |
| `delta`          | Ordered ephemeral text, reasoning, tool-input, or compaction progress |
| `heartbeat`      | Liveness every 15 seconds                                             |
| `error`          | Typed recoverable or terminal protocol failure                        |

There is no standalone cursor frame. Cursor advancement is part of the transaction that applies rows or completes a snapshot.

Rows batch at the smaller of 50 ms, 500 operations, or 1 MiB, merging only whole transactions. Transaction boundaries are not merged when doing so would hide receipt completion or violate atomic visibility, and a transaction that exceeds those bounds uses the continuation rule in §5.2 instead of being flattened. Deltas bypass this delay and are coalesced by animation frame on the client.

### 5.4 Delta ordering

```ts
type DeltaFrame = {
  sessionId: string
  messageId: string
  partId: string
  partKind: "text" | "reasoning" | "tool-input" | "compaction"
  offset: number
  text: string
}
```

The owner field is `messageId`, not `assistantMessageId`, because compaction streams into a compaction message rather than an assistant message; for that kind `partId` equals `messageId` (§4.1). Part identity includes the owning message because provider-local IDs can repeat, and includes the kind because content IDs are unconstrained provider strings shared across three content types.

`offset` is a byte offset into the UTF-8 encoding of the part's eventual finalized text, and every chunk begins and ends on a code point boundary. The client tracks offsets as encoded bytes rather than JavaScript string indices, which are UTF-16. A frame that starts mid-code-point is treated as a gap, not decoded speculatively.

The client buffers a delta until the durable start row exists, accepts only its next contiguous offset, deduplicates repeats, and marks a gap as incomplete. Reconnect does not pretend deltas are replayable. The authoritative finalized row replaces the external value by row revision and clears incomplete state. Old-generation deltas are discarded.

### 5.5 Reconnect, backpressure, and retention

The fetch-SSE client treats three missed heartbeats as dead, reconnects with jittered exponential backoff from 1 to 60 seconds, and creates a new attachment generation. Authentication, unsupported protocol, and malformed-frame errors are terminal until user action or capability change.

The server bounds streams per principal/IP, active Session scopes per stream, control churn, queued bytes, and snapshot work. A slow durable consumer is disconnected and resumes from its committed cursor; durable rows are never silently dropped. Ephemeral deltas may be coalesced, but a gap is explicit and final rows remain authoritative.

Typed reasons include `snapshot_required`, `feed_replaced`, `slow_consumer`, `subscription_revision_conflict`, `unsupported_protocol`, `unauthorized`, and `malformed_frame`.

Retention uses explicit age and maximum-size targets. Deletion and `retained_floor` advance in one transaction. A cursor with another `feedId` or below the retained floor receives `snapshot_required` for affected scopes.

### 5.6 HTTP and browser security

Transport requirements are **per origin class** (§3.4) and §10.3 states the full matrix. Two rules hold everywhere and admit no override in any runtime:

- A non-loopback plain-HTTP server is rejected.
- HTTP Basic credentials are never sent over an untrusted plain HTTP connection.

The loopback allowance is not global. It applies on the server-embedded origin, where the page is itself plain HTTP and a loopback target is same-origin or same-address-space. It does **not** apply on the hosted `https://app.hena.dev` origin, which rejects every plain-HTTP address including loopback; §10.3 explains why that is a rule rather than a bug.

The connect surface rejects URL userinfo, unexpected redirects, mixed content, and certificate failures.

Fetch-based SSE carries the normal `Authorization` header and owns reconnection. Cross-origin servers implement a configured exact-origin allowlist, bounded method/header preflights, `Vary: Origin`, and Private/Local Network Access responses only for approved origins. Cookies are not used for cross-server authentication.

All API, SSE, content, OAuth, and bootstrap responses use appropriate `Cache-Control: no-store` or `no-cache, no-transform`; the service worker explicitly excludes them.

---

## 6. Client data layer

### 6.1 Data tiers

| Tier | Mechanism                                | Use                                                                        |
| ---- | ---------------------------------------- | -------------------------------------------------------------------------- |
| 1    | `henaCollectionOptions` plus persistence | Manifest collections with snapshots/change feed                            |
| 2    | `queryCollectionOptions`, on demand      | Row-shaped request results without a feed                                  |
| 3    | Plain `useQuery`                         | One-off online reads such as full content, OAuth status, and release notes |

Tier 2 is request-backed, not assumed static. Each use defines supported predicate pushdown, cache key, abort/debounce behavior, page bounds, freshness, and invalidation. `fs.list`, `fs.find`, references, and symbols use this tier. Skills remain tier 1 because the server publishes a source revision and replacement snapshot.

### 6.2 Connection and row identity

**A connection's identity is its canonical base URL.** There is no separate client-generated UUID. The canonical base URL namespaces local rows, cursors, stream state, drafts, receipt waiters, OAuth attempts, and outbox storage, and it is what §7.1 encodes into every route. A separate server `feedId` (§4.2) detects endpoint replacement and proves server sameness across an address change.

This is a deliberate reversal of a UUID-based scheme. A UUID is more comfortable internally — it survives an address change for free — but it is meaningless to any other device, so a copied URL cannot resolve anywhere but the profile that minted it. Making the address the identity is what allows §7.1's slug to be self-describing, and the cost is paid once, in the Move flow below, rather than being spread across every shared link.

#### Canonical form

The canonical base URL is derived once, at entry, and stored:

- Scheme and host are lowercased.
- A default port is omitted: `:443` for `https`, `:80` for `http`.
- A path prefix is preserved, with any trailing slash stripped. Reverse-proxied servers at `https://x.example/hena` are a supported deployment and dropping them would be a regression against `packages/app`.
- Userinfo, query, and fragment are rejected outright rather than stripped, because silently discarding them changes what the user asked for.
- Username and password are attached to the connection but are **not** part of its identity.

Canonicalization is the primary key derivation, so it is exhaustively unit-tested (§11.2). A rule that is too loose merges two servers' local data; a rule that is too tight orphans it.

#### Changing a server's address

Because the address is the key, editing it is not an edit — it changes the primary key. `packages/app` handles this by deleting and re-adding, which silently orphans that server's per-server state. A server moving from `https://box.local` to `https://box.tail.ts.net` is routine, not exotic, so V3 makes it a first-class operation:

**Move** is an explicit, confirmed action that probes the new address, reads its `feedId` from §5.1's capabilities response, and verifies it matches the current connection's. Only then does it transactionally re-key that connection's cached rows, drafts, outbox entries, tombstones, and device token from the old identity to the new, and rewrite the current route and in-app history entries. It refuses when the new address is already registered, when the probe reports a different `feedId`, or when the probe cannot establish one. Editing the display name or credentials is an ordinary edit and does not go through Move, because neither is part of the identity.

#### Removal and tombstones

Removing a connection with pending work is blocked until the user drains, exports, or explicitly discards it. Removal wipes that identity's rows, cursors, drafts, outbox, OAuth state, and credentials through a clear confirmation, and revokes its device token where the server is reachable.

A self-describing slug creates a loop a UUID scheme never had: removing a server leaves history entries that still encode its address, so an ordinary Back press would offer to add back the server just deleted, and a stale bookmark would quietly re-onboard it. Removal therefore records the canonical address in a small durable **tombstone** list. Navigating to a tombstoned slug shows "You removed `https://x.example` from this device" with an explicit re-add action — never the ordinary connect gate of §7.1. Re-adding clears the tombstone.

### 6.3 Startup gates

Startup is a set of independently observable gates, not a linear ladder. Several run concurrently, and describing them as ordered states would contradict §6.4, which requires hydration and network intake to overlap.

| Gate                   | Meaning                                                                    | Unblocks                     |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------- |
| `shell-ready`          | Theme, locale, route, and the draft index are available                    | Navigation and draft editing |
| `persistence-starting` | SQLite worker/WASM and outbox stores are initializing                      | -                            |
| `metadata-ready`       | Persisted cursors and scope metadata are readable                          | Publishing synchronized rows |
| `data-hydrating`       | Persisted rows are still loading while incoming transactions buffer        | Cached reads, progressively  |
| `durability-ready`     | Per-server outbox executors accept durable mutations                       | Queueable mutations          |
| `syncing`              | Capability negotiation, snapshots, and live streams are running            | Live data                    |
| `ready`                | Cached state is published and every connection has an explicit sync status | Steady-state UI              |

Only these orderings are required:

- `metadata-ready` precedes publication of any synchronized row, because a row published without its cursor can be lost or duplicated on resume.
- `durability-ready` precedes acceptance of any queueable mutation.
- `shell-ready` precedes nothing else; it is deliberately reachable before persistence exists.

Everything else may overlap. In particular `syncing` does not wait for `durability-ready`: a connection may stream and buffer rows while outbox executors are still opening, since reads do not depend on the outbox. Queueable mutations remain refused during that window, and the composer shows "finishing offline setup" rather than pretending a prompt is durable.

If persistence is unavailable, the profile enters in-memory mode instead of stalling at a gate, and the user gets a persistent in-memory-mode warning. Reads and online-only operations may continue. Queueable offline mutations are disabled unless the operation succeeds online and the UI clearly describes that it is not crash-durable. Killing or reloading at any startup boundary must not lose an operation the UI reported as queued.

### 6.4 Persistence

Tier-1 collections use `persistedCollectionOptions` around the custom sync adapter with explicit `schemaVersion`. Metadata cursors and row operations commit together. The exact ordering is the one §6.3 gates: `metadata-ready` gates publication, persisted row hydration continues concurrently, incoming transactions buffer until safe publication, and readiness waits for the remaining gates. Do not describe this as unconditional hydrate-before-network.

A synchronized row-shape mismatch resets only confirmed cache data. Before reset, pending outbox payloads and client-owned drafts are decoded or preserved as dead letters. Outbox payloads have independent versions and migrations.

Indexes are selected from measured query plans. `BasicIndex`, eager auto-indexing, and `BTreeIndex` are candidates, not global rules. Milestone 0 records index memory, bundle, and query-time results for Sessions and parts.

The SQLite worker and WASM are deferred after shell paint but remain part of cold durability-ready performance. WASM/content MIME type, stable database name, Electron origin/partition, quota errors, and disposal are tested.

### 6.5 Multi-tab connection agent

`BrowserCollectionCoordinator` coordinates persisted collection access, but V3 additionally elects one connection agent per database namespace. Every tab publishes leased claims for the Session scopes it needs. The leader subscribes to their union and broadcasts:

- Committed transactions
- Stream and durability state
- Transaction receipts
- Ephemeral deltas
- Runtime/feed changes

Claims pin transcripts against eviction. Leader generation fences stale broadcasts. Handoff reconstructs desired subscriptions from current claims; delta gaps remain explicit until final rows arrive. The outbox leader and connection leader may differ, so receipts and wakeups travel over the channel rather than relying on same-tab memory.

Every per-server `OfflineExecutor` receives unique IndexedDB/database names and unique Web Locks leadership names, derived from the connection identity in §6.2. Library defaults are not reused across servers.

#### Every registered server stays live

All registered connections stream concurrently. The slug (§7.1) names the **focused** server — the one whose data the current route renders — but it does not suspend the others. This is what §2's "one isolated connection agent, outbox namespace, and trust boundary per connection" means in practice: N concurrent streams, N token refreshes, N outboxes, and a failure in one that cannot degrade another.

Keeping every server live is what makes switching instant and background outbox work possible, and it is also why the connection control in §8.1 must escalate to the worst status across all connections rather than reporting only the focused one. The cost is real — concurrent connections on mobile radio and battery — and if measurement shows it is unacceptable, the replacement is an explicit dormant state that every status surface and §6.3 gate represents honestly, not a silent downgrade.

### 6.6 Mutation policy

| Operation class                                | Offline               | Requirements                                                  |
| ---------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| Create Session and admit prompt                | yes                   | Compound operation or ordered client IDs; exact retry ledger  |
| Admit prompt to existing Session               | yes                   | Client message ID, delivery mode, fingerprint, receipt        |
| Cancel/reorder queued input                    | yes, bounded          | Expected queue revision; retain conflict as editable intent   |
| Non-secret replace-style setting               | yes                   | Expected revision and conflict UI                             |
| Permission/question reply                      | no                    | Pending nonce/revision, short expiry, immediate online result |
| Revert stage/commit/clear                      | no                    | Current filesystem/Session revision and explicit preview      |
| OAuth and secret/provider credential writes    | no                    | Never enter collection, outbox, logs, or BroadcastChannel     |
| PTY create/resize/kill                         | no                    | Runtime-scoped and immediately reconciled                     |
| Server connection removal or credential change | local controlled flow | Drain/export/discard pending work first                       |

Queued-input cancel and reorder need protocol surface that does not exist yet: the server admits and promotes inputs but exposes no cancel, no reorder, and no queue revision. Adding them is Milestone 0 work, and until they exist the composer offers no reorder affordance rather than faking one locally.

The outbox stores versioned operation name, bounded payload, idempotency key, request fingerprint, connection identity (§6.2), creation time, and expiry. Registry names are stable, but unknown or incompatible records are never silently dropped. They move to a visible dead-letter view with Retry, Edit/Recover Draft, Export, and Discard.

This requires intercepting upstream behavior rather than inheriting it. Upstream treats a `NonRetriableError` as terminal and removes the transaction from its outbox, and routes unknown operation names through `onUnknownMutationFn`; both paths end in a record the user can no longer see. The wrapper captures terminal failures and unknown names into the dead-letter store before upstream removal completes, because a removed record is lost user intent, not a resolved failure.

Retry classification is typed rather than based on error-message substrings. Authentication pauses a server queue for credential repair; validation and idempotency conflicts stop the item; network and transient 5xx errors back off with jitter. Expiry is enforced by V3's executor wrapper on both restored and current-process attempts, not by assuming upstream `beforeRetry` runs before every retry.

Strict FIFO applies only where operation dependencies require it. Independent urgent online actions are not blocked behind an unrelated retried setting. The implementation records its chosen lanes/dependency model in Milestone 0 because `maxConcurrency` in the audited upstream version is not effective.

`$synced` may decorate a row as optimistic, but it is not the durable outbox source of truth. The outbox view and operation-level status read executor records directly, including optimistic deletes and retry metadata.

### 6.7 Streaming text

Final part rows live in the `parts` collection; a compaction delta finalizes onto its `messages` row instead, under the same identity and revision rule. In-flight deltas live in a per-part external store exposed through `useSyncExternalStore`. Subscription isolation limits React updates to the part subtree; it does not claim that Streamdown changes only one DOM text node.

Finalize by matching part identity and row revision, committing the authoritative row, and clearing the external entry in one publication boundary. Preserve a visible incomplete marker after a delta gap until final content arrives.

### 6.8 Retention and local data controls

List rows are bounded projections, not assumed permanently small. Session lists exclude large diff/revert bodies. Measured age/size limits are added if list storage exceeds its budget.

Transcript residency uses approximate encoded bytes tracked per Session, with initial total targets of 50 MiB desktop and 20 MiB mobile capped below available quota. Origin-wide `navigator.storage.estimate()` informs the total ceiling but is not treated as per-Session accounting.

Never evict a Session that has any tab claim, pending outbox entry, active run, reader mode, dependent review, selected text, or unresolved deep-link target. Eviction fences/unsubscribes the scope, waits for acknowledgement, atomically removes messages, parts, scope metadata, and delta state, and records LRU residency. Old-generation frames cannot recreate it.

Request `navigator.storage.persist()` only after explaining the local data policy. Settings include per-server usage, Clear Cached Transcripts, and Remove All Local Data. Server removal can securely forget its local namespace and credentials.

### 6.9 Client-only state

Use separate stores by scope:

| Scope             | Examples                                              | Storage                                         |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Profile-global    | theme, language, keybindings, project order           | small local collection                          |
| Connection/entity | last agent/model, non-secret preference               | namespaced local collection                     |
| Window-local      | panel widths, collapsed regions, restored route       | session/window storage or Electron window store |
| View-local        | scroll anchor, follow state, open disclosure          | memory with optional window restore             |
| Draft-owned       | text, selection, mentions, attachments, delivery mode | versioned durable draft store                   |

LocalStorage collections are bounded because they serialize synchronously and have small quotas. Draft schema changes use migrations, never reset. Concurrent draft editing uses an ownership lease or creates a conflict copy; it never silently overwrites another tab.

Drafts span two stores, because §6.3 makes draft editing available at `shell-ready` while the durable draft store only opens during `persistence-starting`:

- The **draft index** (draft ID, route, title, updated-at) is a bounded synchronous local store, so the shell can list and route drafts immediately.
- **Draft bodies and attachment bytes** live in the durable draft store.

Editing before the durable store opens is allowed, and the composer marks such a draft "not saved on this device yet" until the durable store accepts it. This is the same honesty rule prompts get, applied to drafts; the alternative is a draft that looks saved at `shell-ready` and disappears on reload.

Ephemeral hover, menus, and in-flight form input remain React state.

---

## 7. Application shell

### 7.1 Routes

```text
/                                                 replaces with /:server, or /connect when empty
/connect                                          add the first server; the only server-less route
/:server                                          that server's project list
/:server/:projectId                               project Session list
/:server/:projectId/new/:draftId                  new Session draft
/:server/:projectId/session/:sessionId            Session
/:server/:projectId/session/:sessionId/review
/:server/:projectId/session/:sessionId/files
/:server/settings/:section                        settings; the section decides profile-wide or server-owned
```

Path parameters are written `:name` here for readability; TanStack Router file routes use its own `$param` syntax, and the table describes URL shape rather than file naming.

#### The server slug

`:server` is **base64url, unpadded, of the connection's canonical base URL** (§6.2). It is the first segment of every route except `/connect`.

Decoding applies a round-trip canonicality check: the decoded value is re-encoded and must equal the original segment exactly, and the decoded value must itself be a canonical base URL. This rejects alternate encodings, padded variants, and arbitrary strings, and it is the same guard `packages/app` applies to its `serverKey` segment. A segment that fails the check is a malformed route, not an unknown server.

Putting the slug first removes §7.1's previous need to reserve `settings` as a first segment, and moves that reservation one segment right: `settings` is a reserved project ID. Literal segments match before parameters, so the match is deterministic. The collision is theoretical in the other direction too — base64url of any real `https://` URL is far longer than the word `settings` — but the reservation is stated rather than assumed.

Settings collapses from two routes into one. §8.6's sections are already disjoint between profile-wide (appearance, notifications, keybindings, general) and server-owned (providers, models, MCP servers, server connections, storage/diagnostics), so one closed section set serves both and the slug supplies the server for the server-owned ones. Profile-wide sections carry the slug without being scoped by it; it preserves the server you return to.

#### Resolving a slug

Every navigation resolves the decoded address against the registry, in this order:

1. **Registered** — render the route.
2. **Tombstoned** (§6.2) — show "you removed this server" with an explicit re-add action. Never the connect gate.
3. **Unknown** — show a blocking confirmation gate naming the decoded address, its transport verdict (§10.3), and a credential form when the probe reports `401`. Accepting registers the connection permanently and continues to the deep-linked route; declining leaves the profile untouched. This satisfies §10.6's rule that server-add links require confirmation and transport validation, and it makes a pasted link the primary onboarding path on the hosted origin.
4. **Malformed** — a route error, not a connect prompt.

A copied route is genuinely portable: it carries the address, so a recipient can act on it. It never carries credentials (§10.3) and never auto-adds a server.

The project route never redirects as a route side effect. On mobile it is the list root; selecting a Session pushes detail, and Back returns to the list. Desktop may show an empty or most-recent detail pane without changing that URL contract.

Message anchors use `#message-<id>`. File/review selection uses bounded URL search parameters so reload, Back, and deep links restore it. A draft has a stable route and survives reload.

Loaders validate route syntax and start non-awaited subscription claims. They never wait on API data. Views distinguish hydrating, cached/stale, connecting, offline with cache, offline without cache, unauthorized, unsupported protocol, not found, deleted, and permanent sync failure. Invalid project/Session ownership fails closed.

### 7.2 Layout

The desktop/wide layout has:

1. A fixed project rail for the **slug's server only**, sorted by recent activity.
2. A collapsible Session list for the selected project, sorted by recent activity.
3. One content pane.
4. A connection control in the top-right of the titlebar (§8.1).

The rail is scoped to one server rather than spanning all of them, and there is no Inbox. Both are deliberate reversals of an earlier cross-server design: the rail stays short on the 64px mobile column, and every list in the app answers to the server named in the URL, so a route never shows data belonging to a server it does not name. Every registered server still stays live (§6.5), so switching is instant and background work is not suspended — but the rail does not try to represent all of them at once.

Switching servers is therefore the connection control's job (§8.1) and the command palette's, not the rail's.

Project reorder uses pointer and keyboard drag controls, persists profile-wide, and announces movement. Server identity and status are visible without relying on color; a status dot always pairs with a shape, glyph, or text.

There are no application tabs. Switching Sessions may unmount view components but does not terminate server resources such as PTYs without an explicit lifecycle action.

### 7.3 Mobile navigation

- Project Session list is the project root.
- Project switching is a left slide-over with a visible button; edge swipe is optional, not the only action. Server switching is not in the slide-over; it stays in the connection control so there is exactly one place to do it.
- Review and files are full-screen subroutes.
- Back closes popover, drawer, subroute, Session, then project in that order.
- Focus moves to the pushed screen heading and returns to the initiating control on pop.
- Safe areas use `viewport-fit=cover`; keyboard behavior also observes `visualViewport` where required.

Test browser and installed-PWA behavior on real iOS/iPadOS and Android devices. `interactive-widget=resizes-content` alone is not considered sufficient.

### 7.4 Density and input capability

Touch-safe sizing is the default whenever any coarse pointer exists:

Visual density and touch-target size are two variables, not one, because a compact preference must be able to change the first without touching the second:

```css
:root {
  --hit-area: 44px; /* minimum interactive target */
  --row-height: 44px; /* content row density */
}

/* Compact density: any fine pointer, unless the user asked for comfortable. */
@media (any-pointer: fine) {
  :root:not([data-density="comfortable"]) {
    --row-height: 28px;
  }
}

/* An explicit compact preference applies on every device and never touches --hit-area. */
:root[data-density="compact"] {
  --row-height: 28px;
}

/* Only a device with no coarse pointer at all may go below the 44px target floor. */
@media (any-pointer: fine) and (not (any-pointer: coarse)) {
  :root {
    --hit-area: 28px;
  }
}
```

The guards are mutually exclusive rather than order-dependent, so a touchscreen laptop keeps a 44px target floor while still honoring a compact preference. Where a row is itself the interactive control, it uses `min-height: max(var(--row-height), var(--hit-area))`, so compact density reduces content rows without producing targets too small to hit.

An explicit compact/comfortable preference can override visual density but never reduces required touch targets for a coarse interaction. Hover actions also appear on keyboard focus and always have a visible menu alternative.

---

## 8. Product surfaces

### 8.1 Server connections

There is no Inbox. Permission and question requests render in their Session, using the immutable request identity and pending-reply state described in §8.2 and §8.9. Replies are online-only by default, carry a pending nonce/revision and expiry, become disabled while resolving, and reconcile an already-resolved race without a destructive error.

The surface that replaces it is server management, because with the rail scoped to one server (§7.2) the connection control is how a user moves between servers at all.

#### The connection control

A single control occupies the top-right of the titlebar on every route. It renders:

- The **focused** server's display name, meaning the server named by the current slug.
- A status badge that escalates to the **worst** state across every live connection, not just the focused one.

The escalation is the point. Every registered server stays live (§6.5), so a background connection can be unauthenticated, backing off, `upgrade_required`, or permanently failed while the focused server is perfectly healthy. A control that reported only the focused server would let the one always-visible status indicator in the application read "fine" while another server had been dead for an hour. Opening the surface shows which connection is actually degraded.

Status is never color alone (§7.2, §9.4). The control reserves its width so the titlebar does not reflow as the focused server's name changes across navigation.

Activating the control opens the server-management surface.

#### One surface, two mounts

The connection list, add form, Move flow, credential form, and per-server detail are **one component tree with one shared state**. The titlebar control mounts it as a modal; §8.6's `server connections` section mounts the same tree inline at `/:server/settings/server-connections`.

`packages/app` reached the same conclusion the hard way, extracting `useServerManagementController` after building the dialog and the settings tab separately. V3 starts there. Every state below — `401`, `upgrade_required`, transport-blocked, tombstoned, pending outbox work, migrating — is written once and tested once, and the settings route stays linkable while the modal stays reachable from anywhere.

#### Actions

| Action              | Behavior                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Add                 | Address, optional display name, optional username and password. Validated per §10.3 before persisting |
| Switch              | Clicking a healthy row navigates to `/:target` and closes the surface                                 |
| Move                | Explicit address change with `feedId` verification and transactional re-keying (§6.2)                 |
| Edit                | Display name and credentials only; neither is part of the identity                                    |
| Re-authenticate     | Mints a new device token (§10.3) without touching cached rows                                         |
| Remove              | Blocked on pending work; wipes the namespace, revokes the token, writes a tombstone (§6.2)            |
| Sign out this device | Revokes the device token and keeps the connection and its cached rows                                |

Switching is a plain navigation because the slug **is** the active server. There is no separate active-server state to flip, so the navigate-then-flip-in-a-microtask race `packages/app` works around cannot occur. The current project and Session cannot survive a switch — they do not exist on the target — so the destination is always the target's project list, and no name-matching heuristic tries to guess an equivalent project. Unreachable servers are not clickable to switch, only to diagnose.

The command palette gains a "Switch server" command so the whole flow has a keyboard path, matching V2's `command.server.switch`.

#### The connect route

`/connect` is the only server-less route and is where `/` lands when the registry is empty. It is a real route rather than an auto-opened modal, so it is linkable from documentation, reachable after the last connection is removed, and has room for the thing an address field alone cannot convey: which transports work from this origin, and why (§10.3, §3.4).

Per §3.4 it also names the origin the current profile belongs to, because "why are my servers missing" is otherwise indistinguishable from data loss.

#### Zero-configuration on the embedded origin

On a server-embedded origin the serving server is seeded into the registry at boot, addressed by the same base64url slug as every other connection, and marked as the origin's own server so Remove is disabled. Removing it would leave a UI served by a server it refuses to talk to, and the tombstone rule would then suppress re-adding it on reload.

The slug encodes the origin twice in a URL served from that origin, which looks redundant. It is accepted deliberately: a reserved literal such as `~self` would be shorter but would mean a different machine on every origin, so a copied URL would silently resolve to the wrong server — exactly the failure the address-in-slug decision exists to eliminate. Uniform encoding keeps one code path and one meaning.

#### First implementation slice

The first slice ships this surface against a **real persisted registry and a mocked network**. The registry is real client-owned state: real add, Move, remove, reorder, real canonicalization, real base64url encoding and decoding, real validation, real tombstones, persisted locally and surviving reload. Status, version, and `feedId` come from a mock probe module behind a single seam that the real §5.1 capabilities call replaces later.

The mock-only `app-v3` shell may prototype this surface with in-memory fixtures before that slice. Such a prototype is non-shipping UI validation and does not satisfy the persisted-registry acceptance criteria above.

This is the smallest slice in which the slug, the confirmation gate, and Move-with-migration are demonstrable and testable end to end without a server. Mock fixtures use HTTPS addresses, since the hosted origin rejects plain HTTP (§10.3).

### 8.2 Session transcript

Completed history uses TanStack Virtual. The active message renders below it in normal flow. Rows are stable by identity, not assumed immutable in height. Measurement keys include content revision, width, font, locale, and disclosure state; remeasurement preserves the semantic scroll anchor.

Tool calls are concise expandable rows with tool, primary argument, status, duration, and bounded input/output. Consecutive calls may group only when doing so preserves stable identities and keyboard navigation. Reasoning has a remembered disclosure preference. File edits open the review route at the file.

Streamdown renders Markdown with raw HTML disabled. `@streamdown/code` supplies reviewed code rendering and lazy Shiki languages. Remote images are blocked by default; safe links use allowed schemes, no opener, and no referrer. Code, tool output, and filenames enter the DOM as text.

Non-assistant message types have defined renderings rather than falling through to the unknown-part fallback: `compaction` is a bounded system row that streams its summary and, once final, states what was compacted and links to retained history where the server exposes it; `shell` shows command and bounded output under the §4.4 preview limit; `agent-switched` and `model-switched` are compact system rows; `synthetic` and `system` are visually distinct from user text so injected content is never mistaken for something the user wrote.

Unknown part types render a bounded forward-compatible fallback. A part error boundary exposes a safe copy-details action without stopping adjacent streaming.

Reader mode is available from the transcript heading and a stable URL search parameter. It progressively renders the full transcript without violating the long-task budget, preserves the nearest message/focus when toggled, supports message anchors and browser Find, avoids repeatedly announcing history, and pins the transcript against eviction.

### 8.3 Composer

Use a native `<textarea>` with an absolutely positioned highlight mirror. The mirror is `aria-hidden`, `pointer-events: none`, and exactly matches font metrics, padding, line height, tab size, wrapping, direction, zoom, scrollbar, and scroll offsets. Assistive technology encounters only the textarea value.

Enter never sends while IME composition is active, including keycode-229 fallback. Composition updates do not navigate mention/command pickers.

Plain Enter depends on input capability, and the default is explicit rather than implied:

| Context                                  | Enter   | Shift+Enter | Mod+Enter | Mod+Shift+Enter |
| ---------------------------------------- | ------- | ----------- | --------- | --------------- |
| Any fine pointer (keyboard-first)        | sends   | newline     | sends     | queues          |
| Coarse-only (phone, tablet, no keyboard) | newline | newline     | sends     | queues          |

On a coarse-only device the on-screen Return key inserts a newline and sending requires the send control, because a keyboard Enter that sends is the most common way to post a half-written prompt from a phone. A user preference overrides the default in both directions; `Mod+Enter` and `Mod+Shift+Enter` always work regardless of pointer class or preference. Undo/redo, autocorrect, dictation, paste, selection, and mobile keyboard behavior remain native.

Mention and command popovers implement combobox/listbox semantics without stealing composition events. Attachments are chips below the input. Draft persistence includes text, selection, mentions, agent/model, delivery mode, and attachment metadata/order; attachment bytes follow §4.4 and live in the durable draft store, so a chip never survives a reload whose bytes did not.

Agent and model selectors are searchable. Defaults come from the project, then become Session-specific. A mid-Session change is recorded as a system row and applies at the server-defined provider-turn boundary.

Sending while running defaults to steer. Explicit queueing creates a durable `sessionInputs` row in a visible queued group. Reorder and cancel use server revisions and reconcile promotion races. Permanent failure retains editable intent rather than reducing recovery to a toast.

### 8.4 New Session

The global new action opens a routed draft. Project, agent, and model default from the last valid selection but remain editable. The Session and first prompt use either one atomic endpoint or one compound outbox operation with client-generated Session and message IDs. A crash between creation and admission cannot produce duplicates; an orphaned empty Session is reconciled visibly.

### 8.5 Review and files

Use `CodeView` and `File` from `@pierre/diffs/react`. Worker offload is explicit through the documented worker factory and `WorkerPoolContextProvider`. Theme integration accounts for the Shadow DOM: inheritable custom properties may cross it, ordinary selectors do not.

Review is stacked on mobile and split on desktop. Selection/copy, very long lines, large-file bounds, worker cancellation, forced colors, and matching Shiki themes are tested.

Revert and fork are message-anchored. Revert stage, commit, and clear are online-only and require current Session/filesystem revisions. The review accurately represents whether accept/reject is whole-file, hunk, or operation-level; the UI does not expose finer controls than the server can commit atomically.

Full file content is tier 3, revisioned, bounded, and not claimed to work offline unless already held in memory. HTML and SVG source is shown as text or download-only, never executed.

### 8.6 Settings

Settings is a full route at `/:server/settings/:section` (§7.1). Sections are a closed set and are disjoint between the two kinds:

- **Profile-wide:** appearance, notifications/sound, keybindings, general. These carry the slug without being scoped by it; it records the server to return to.
- **Server-owned:** providers, models, MCP servers, server connections, storage/diagnostics. These are scoped to the slug's server.

`server connections` mounts the same component tree as the titlebar modal (§8.1), not a parallel implementation.

Fields expose `clean`, `dirty`, `saving`, `queued`, `saved`, `invalid`, `failed`, and `conflicted`. Debounced writes flush on blur, navigation, `pagehide`, and desktop close. Authoritative rollback updates the visible control and announces field errors.

Only non-secret replace-style settings may use the outbox. Passwords, API keys, OAuth codes/verifiers/tokens, and secret MCP/provider fields remain transient and online-only. They never enter collections, query caches, outbox records, BroadcastChannel messages, diagnostics, or console logs.

OAuth uses PKCE S256 and state validation where supported. Attempts are random, expiring, bound to the originating server/client, cancellable, rate-limited, and never persist codes or verifiers. Electron opens validated HTTPS authorization URLs in the system browser, never in the privileged renderer.

### 8.7 Commands

Use two distinct concepts:

- `serverCommands`: synchronized Location-scoped commands supplied by the server.
- `uiCommands`: local application actions.

The UI command collection contains only serializable descriptors such as ID, localized title key, group, keybinding, enabled/checked state, scope, and optional menu placement. Runtime `when` and `run` callbacks live in an in-memory map keyed by ID. Electron receives descriptor snapshots and returns only command IDs.

Define duplicate-ID rejection, route versus global lifetime, keybinding conflict resolution, OS/browser-reserved shortcuts, standard Electron roles, and native-menu localization. Server-provided data can never register a renderer callback or privileged native action.

### 8.8 Search

Projects, Sessions, and UI commands use bounded local fuzzy search over synchronized metadata. Files, references, and symbols use cancellable/debounced tier-2 server queries with explicit pages. Message-content search remains out of scope and the UI does not imply otherwise.

### 8.9 Sync status and failure UX

Each connection exposes transport, feed synchronization, and durability separately. Normal live state is ambient. Reconnecting or offline cached data shows last successful sync age after a short threshold; stale data is never silently presented as current indefinitely.

Rows may show optimistic state through `$synced`, but operation status comes from the outbox. Permanent failures remain in an actionable failed-work view. Authentication pauses queue processing and links to credential repair. Unsupported protocol links to upgrade instructions.

Top-level routes use an explicit state matrix rather than endless skeletons: hydrating, cached/stale, connecting, offline cached, offline empty, unauthorized, upgrade required, missing/deleted, and permanent failure.

### 8.10 Terminal

Milestone 2 wraps `ghostty-web` imperatively; React mounts, unmounts, and resizes but does not render terminal cells. PTY ticket auth remains short-lived and runtime-scoped.

A PTY belongs to a Session and has explicit attach, detach, reconnect, terminate, and server-restart behavior. Switching Session detaches the view but does not terminate the PTY. Multiple PTYs, background lifetime, serialization bounds, resize throttling, and close confirmation are specified and tested. Terminals are available only on desktop and sufficiently wide viewports.

### 8.11 Share

Share is split between two products, and V3 owns only one half.

V3 owns the **authoring** side: creating a share link for a Session, seeing that a Session is shared, copying the link, and revoking it. All three are online-only and never enter the outbox, because a share link is a security-relevant publication whose effect cannot be honestly queued. Creation shows exactly what becomes publicly readable before it happens, and revocation reports the authoritative result rather than an optimistic one. Shared state is a field on the Session row, so the project and Session lists can show it without an extra request.

V3 does not own the **viewer**. The public share page lives in `packages/enterprise` and renders with `@hena/session-ui` today. Per §3.2 that viewer must migrate off `@hena/session-ui` before the package is deleted; that migration is not part of the V3 application, and V3 must not be assumed to replace it. If the viewer is retired instead of migrated, share authoring is removed from V3 in the same change rather than left pointing at a dead route.

---

## 9. Presentation, accessibility, and content security

### 9.1 Components and themes

Use shadcn/Radix with native shadcn tokens. Ship light, dark, and two or three curated first-party themes. The V2 theme catalog and `--v2-*` tokens do not migrate. Each theme includes matching Streamdown and diff/Shiki themes.

A hashed inline preload script reads only the bounded theme/locale bootstrap keys, sets root color state before render, and updates `theme-color`. It does not require a general `unsafe-inline` CSP exception.

### 9.2 React authoring

Enable React Compiler and enforce its diagnostics in CI. The compiler may skip components or libraries and does not replace performance tests. Avoid manual memoization by default, but allow measured exceptions around virtualization or third-party boundaries with a comment and regression test.

### 9.3 Internationalization and direction

The port happens as one pass across `packages/app-v3`, not incrementally per feature (§12.2). Until it runs, V3 source carries hardcoded English, which is the state the package is already in; a partially translated package invites both patterns to spread and forces churning copy to be translated repeatedly.

Port all existing dictionaries and add every V3 key. The release locale set is the eighteen V2 dictionaries: `ar`, `br`, `bs`, `da`, `de`, `en`, `es`, `fr`, `ja`, `ko`, `no`, `pl`, `ru`, `th`, `tr`, `uk`, `zh`, `zht`. Dropping a locale is a product decision recorded here, not an outcome of an incomplete port. Locale chunks load dynamically without a wrong-language first paint. Key, placeholder, and desktop-native-string parity for all release locales runs in CI. Dates, relative time, numbers, lists, sorting, and plurals use appropriate `Intl` APIs.

Full mirrored RTL layout is deferred. Until it ships, Arabic is labeled beta rather than fully supported. User prose uses `dir="auto"`; paths, commands, hashes, and code use isolated LTR spans. Mixed Arabic/Latin content receives visual regression coverage. Stable release notes disclose the limitation.

### 9.4 Accessibility

Target WCAG 2.2 AA for every stable product surface, not only the core loop.

- Every hover, swipe, drag, and long-press action has a visible keyboard-operable alternative.
- Route changes manage and restore focus.
- Status is not color-only.
- Optimistic reconciliation preserves focused controls.
- Streaming does not announce every token; completion and actionable requests use bounded live regions.
- Virtualized rows use correct list/article semantics; reader mode covers unmounted history and browser Find.
- Test 200%/400% zoom, text spacing, forced colors, reduced motion, keyboard-only use, and coarse targets.
- Supplement axe with manual VoiceOver/Safari, NVDA/Firefox or Chromium, and TalkBack/Chrome checks.

### 9.5 Motion

Motion communicates spatial continuity only, lasts 150-200 ms, and is disabled by `prefers-reduced-motion`. Functionality and state changes never depend on animation completion.

### 9.6 Content security policy

Browser and Electron responses enforce a reviewed CSP. The full directive set is written out because the hard cases are the ones usually left implicit:

| Directive         | Value                             | Why                                                              |
| ----------------- | --------------------------------- | ---------------------------------------------------------------- |
| `default-src`     | `'self'`                          | Baseline                                                         |
| `script-src`      | `'self' 'sha256-<theme-preload>'` | Hash for the §9.1 preload only; no general `unsafe-inline`       |
| `style-src`       | `'self'`                          | Stylesheets are bundled                                          |
| `style-src-attr`  | `'unsafe-inline'`                 | Radix/shadcn set inline `style` attributes that cannot be hashed |
| `img-src`         | `'self' data:`                    | Remote images are blocked by default (§8.2)                      |
| `font-src`        | `'self' data:`                    | Self-hosted fonts                                                |
| `worker-src`      | `'self' blob:`                    | Persistence, diff, and highlight workers                         |
| `connect-src`     | see below                         | User-entered servers cannot be enumerated ahead of time          |
| `base-uri`        | `'none'`                          | Blocks base-tag injection                                        |
| `object-src`      | `'none'`                          | No plugins                                                       |
| `frame-ancestors` | `'none'`                          | No embedding                                                     |

`style-src-attr 'unsafe-inline'` is the one real concession, and it is stated rather than hidden: the component library sets inline style attributes, attribute values cannot be hashed, and a nonce does not apply to them. It is bounded by `style-src 'self'` for stylesheets, so injected `<style>` elements and remote stylesheets are still blocked.

`connect-src` cannot be a tight allowlist. Servers are entered by the user at runtime (§10.3), so no build-time or response-time list can contain them. The actual defense for server endpoints is the explicit connection model, the per-origin transport rules in §10.3, and the exact-origin CORS allowlist on the server side — not the client CSP.

It differs by origin class, following the transport matrix rather than restating it loosely:

| Origin          | `connect-src`                          | Why                                                            |
| --------------- | -------------------------------------- | -------------------------------------------------------------- |
| Hosted          | `'self' https: wss:`                   | Plain HTTP is rejected there, so no loopback allowance is needed |
| Server-embedded | `'self' https: wss:` plus loopback HTTP | Loopback is a supported target on that origin                   |

The hosted origin's CSP is delivered by `_headers` (§3.5); a static host has no other way to send it.

Add `wasm-unsafe-eval` to `script-src` only if the audited WASM loader requires it; never use unrestricted `unsafe-eval`.

Enable Trusted Types where supported with narrowly named policies around reviewed sanitizers. External links use `noopener noreferrer` and no referrer. Remote content cannot navigate, open popups, register commands, invoke the desktop bridge, or become native menu actions.

---

## 10. Platform

### 10.1 PWA

Use `vite-plugin-pwa` in `generateSW` mode. The precache manifest explicitly includes the shell, persistence worker/WASM, and route chunks required to hydrate and display the product surfaces promised offline. Deferred execution does not imply exclusion from precache; the worker/WASM bytes count toward the measured install cost. Terminal, large diff workers, and all `/api/**`, SSE, content, OAuth, bootstrap, and diagnostics URLs remain excluded unless a later requirement explicitly changes the offline contract.

Navigation fallback serves the versioned shell for client routes only. After one successful online load, the server root, project, Session, new draft, review shell, files shell, and settings routes open from a fresh offline process; features requiring uncached data show an offline state.

A waiting worker never activates over an unsaved draft or in-flight durable admission without an explicit safe reload. The update UI reports the new version, waits for a safe point, activates, reloads, and cleans old caches. Persisted-schema compatibility and service-worker version are tested together. Offline first launch is distinct from an offline returning-user launch.

Manifest, maskable icons, `display: standalone`, Apple metadata, install eligibility, standalone viewport behavior, and Android/iOS add-to-home-screen smoke tests are required.

#### Response headers

Both origins send the same header classes, described once here and implemented twice: in `packages/app-v3`'s `_headers` for the hosted origin (§3.5), and in the embedded UI handler for the server-embedded one.

| Class                                | Header                                            |
| ------------------------------------ | ------------------------------------------------- |
| Hashed build assets (`assets/*`)     | `Cache-Control: public, max-age=31536000, immutable` |
| `index.html`, service worker, manifest | `Cache-Control: no-cache`                        |
| API, SSE, content, OAuth, bootstrap  | `Cache-Control: no-store` (§5.6)                  |

The embedded origin currently sends a content type and nothing else, which leaves browsers applying heuristic caching. That is tolerable for hashed assets and unacceptable for a service worker: a heuristically cached `sw.js` produces an application that cannot be updated and that a user has no way to repair. Explicit headers are a correctness requirement, not an optimization.

Embedded responses are also served uncompressed, because the compression middleware only handles `Uint8Array` bodies while the embedded handler emits raw ones. Compression is extended to cover raw bodies. Loopback makes this invisible locally, but the multi-server model actively encourages reaching servers over a tunnel or LAN, where it is not.

### 10.2 Desktop

The packaged Electron origin is deferred (§3.4) and is not part of the first V3 release. This section describes it when it lands; nothing in it gates the hosted or embedded origins.

The Electron shell consumes a versioned built renderer artifact with a checksum/build step but no TypeScript import from `@hena/app-v3`. The app still has a packaging dependency on that artifact; "no build-time coupling" means no shared renderer Vite configuration or source imports, not no delivery contract.

Preload exposes `window.hena` with `bridgeVersion` and a capability manifest, replacing the current unversioned `window.api` surface typed `ElectronAPI` in `packages/desktop/src/preload`. Required missing capabilities show a blocking compatibility error; optional ones are feature-detected. Runtime validation and size limits protect every IPC argument and result. Main verifies sender frame/origin for every privileged handler.

Maintain `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `webSecurity: true`. Deny renderer navigation and popups away from the packaged origin. Permit only validated HTTPS external URLs. File-picker tokens are sender-bound, one-use/bounded, and released. `openPath` and `revealPath` require a trusted local mapping and direct user action; remote servers cannot supply arbitrary native paths.

The bridge migration includes a disposition table for every current `ElectronAPI` member: retained, replaced, or deliberately removed. Contract tests cover preload declarations, renderer validation, main handlers, deep links, native menus, updater, WSL, storage migration, file pickers, focus/window restore, and packaged builds on supported OSes.

Electron persistence uses the browser OPFS adapter only if Milestone 0 proves a stable secure origin, persistent session partition, upgrade path, packaged behavior, and correct cleanup. The designated fallback is `@tanstack/electron-db-sqlite-persistence`, which runs SQLite in the main process behind an IPC bridge and avoids OPFS in the renderer entirely; it is part of the same audited upstream release train and is evaluated in Milestone 0 rather than discovered later. Only if both fail does the persistence decision return to design review; it is never silently worked around.

### 10.3 Connectivity and credentials

Manual server entry accepts an address, an optional display name, and an optional username and password. The address is canonicalized per §6.2. Input without a scheme is completed to `https://`, never `http://`.

#### Transport by origin class

| Target                            | Hosted `app.hena.dev`     | Server-embedded (`http://host:port`) |
| --------------------------------- | ------------------------- | ------------------------------------- |
| The serving origin itself         | n/a                       | allowed, same-origin                  |
| Loopback plain HTTP               | **rejected**              | allowed                               |
| Non-loopback plain HTTP           | rejected                  | rejected                              |
| HTTPS, any host                   | allowed                   | allowed                               |

The hosted origin rejects loopback plain HTTP as a rule, not an oversight, because the browser behavior underneath it is neither uniform nor stable:

- Chrome and Firefox treat `http://localhost` and `http://127.0.0.1` as potentially trustworthy, so mixed-content blocking does not apply. **Safari blocks it outright with no override**, so the same setup would work for some users and not others with no way to tell them apart in advance.
- Chromium's Local Network Access preflight expects `Access-Control-Allow-Private-Network: true`, which the Hena server does not send. Support that depends on an unshipped server header would break on a browser update, not on a change of ours.

The user this rule affects — someone running `hena serve` on their own machine — is served by the server-embedded origin, where the page and the server are the same origin and none of the above applies. That is why §3.4 keeps the embedded origin rather than shipping hosted-only: without it, this rule would be a product hole instead of a correct per-origin constraint.

#### Diagnosing failures

§5.6 requires certificate, CORS, local-network, authentication, and reachability failures to be explained separately, and the platform actively prevents it: a CORS rejection, a DNS failure, an expired certificate, and an LNA block are one indistinguishable `TypeError`. Only an HTTP status is legible. The connect flow therefore diagnoses in three stages:

1. **Static, before any request.** Scheme mismatch against the origin class, and a private or loopback address targeted from a public page, are pure functions of the two URLs. These produce exact messages with no network involved.
2. **The real probe.** `GET /api/collection/capabilities` with CORS. A `401` means authentication and shows the credential form. Any HTTP status means the server is reachable.
3. **The `no-cors` retry.** On an opaque failure, repeat the request with `mode: "no-cors"`. Success means the server is reachable but **CORS-rejecting**, and the message names the exact origin to add and the `--cors` flag or `server.cors` config key that adds it. This is the single most likely real failure and the one a user has no chance of guessing; without this retry it is indistinguishable from a wrong address.

When both probes fail the cause is unreachable-or-certificate, which cannot be narrowed further from script. The remedy offered is to open the address in a new tab so the browser presents its own certificate interstitial or DNS error.

#### Credentials

The password is **never persisted**. It is typed once and exchanged for a named, revocable **device token**; short-lived access tokens derived from it live in memory only. The device token is stored in IndexedDB, encrypted under a non-extractable `CryptoKey`.

The reasoning is stated plainly because the wrapping is easy to oversell. No browser storage on a static origin is safe from cross-site scripting on that origin: an attacker who can run script can call `subtle.decrypt`. What the non-extractable key does buy is protection against a profile-directory read, a backup, or a trivial storage dump. What the **token** buys is the part that matters — a lost laptop is one revocation, not a password rotation that signs out every other device.

This requires server endpoints that do not exist: token issue, list, and revoke. Until they do, credential entry works but persistence across a browser restart does not, and the UI says so rather than implying otherwise. §14 item 6 is resolved by this decision and closed.

Electron, when it lands, stores tokens in main-process OS-backed storage and injects authorization only for the exact canonical origin.

#### Bootstrap

The legacy `?auth_token=` form is **removed**, not merely deprecated. It is base64 of `username:password` in a query string, which survives in browser history, referrers, and proxy logs on what is about to become the primary UI origin. Leaving it alive alongside a replacement would keep the hole open.

Its replacement: when a password is configured, `hena serve` prints its URL with a single-use code in the **fragment** (`http://localhost:4096/#code=...`). A fragment is never sent to the server and never appears in a proxy log. The client exchanges it immediately for a device token and strips it from the URL. The code is single-use with a short expiry, recorded in a server-side ledger so a replay is refused rather than silently honored.

Auth is skipped entirely when no password is configured, so the common zero-password local server needs no bootstrap at all. Password entry remains available for any server reached by address.

### 10.4 Notifications and badges

Notification permission is requested only from a user gesture in Settings. Default, denied, granted, and unsupported states are visible. Browser notification delivery uses the service-worker registration where required; Electron uses one native bridge path.

One elected tab/window notifies for a fresh event ID. Hydration, snapshot, replay, and reconnect never trigger historical notifications. A focused Hena window suppresses duplicates globally. Default lock-screen text is generic; showing server/project/Session details is an explicit privacy preference. Click routing validates the internal destination. Badging is optional and feature-detected, with defined count and clear semantics.

### 10.5 V2 migration

**There is no V2 migration.** V3 starts with an empty registry and the user adds their servers. This is a deliberate reversal of an earlier plan to import V2's connection records, and the tradeoff is recorded in §13: a user with several servers re-adds them once, and in exchange no first-load path ever decodes, holds, or re-transmits a V2 credential.

What V3 does do is **delete V2's storage keys silently on first load**, because V3 takes V2's exact origin (§3.2) and V2's connection blob contains **plaintext passwords** (`packages/app/src/context/server.tsx`). Left alone, that blob would sit on a live origin indefinitely, read by nothing, deleted by nobody, and readable by any cross-site scripting on the origin. The keys removed are `hena.global.dat:server`, the legacy unprefixed `server.v3`, and `hena.settings.dat:defaultServerUrl`.

The deletion is unconditional and produces no UI. Nothing in the blob is decoded into application state, rendered, or logged; V3 removes the keys without reading their contents. Deletion is idempotent and recorded so it runs once per origin.

The consequence for §3.2's rollback is explicit: a rollback to V2 finds an empty connection list, and the runbook says so rather than assuming V2's state survived.

Theme, closed tabs, layout, drafts, and per-Session settings do not migrate either.

### 10.6 Deep links

Deep links use an allowlisted grammar, strict parser, bounded lengths, replay deduplication, and redacted logging. Prompt-bearing links may prefill a draft but never submit it. Server-add links require confirmation and transport validation. Links never carry passwords, provider keys, OAuth credentials, or arbitrary local paths.

---

## 11. Quality

### 11.1 Test stack

- Unit/component: `bun test`, happy-dom, and React Testing Library, run from `packages/app-v3`.
- Protocol: conformance and property tests against generated frame schemas and a real server implementation.
- Browser E2E: Playwright Chromium and WebKit, including mobile projects.
- Device smoke: at least one current iPhone/iPad configuration and one current Android device.
- Desktop: preload/main/renderer contract tests and packaged smoke on supported macOS, Windows, and Linux versions.
- Accessibility: axe plus the manual matrix in §9.4.
- Performance: stability oracle and reproducible budgets in §11.4.

### 11.2 Required test domains

- Snapshot/live race, scoped replacement, cursor resume, feed replacement, retention gap, and cross-collection transaction visibility
- Stream reconnect, stale generation, slow consumer, malformed/oversized frames, authorization, and subscription revision races
- Receipt-before-HTTP and HTTP-before-receipt ordering, no-op/exact retry, snapshot reconciliation, and txid isolation across servers
- Outbox reload, typed retry, expiry, auth pause, conflicts, dead letters, upgrade/downgrade, and server removal
- Kill/reload at every boundary from UI acceptance through outbox commit, server commit, receipt, rows, and local persistence
- Multi-tab different-Session subscriptions, follower mutation, leader handoff, delta relay, notification election, and pinned eviction
- IME, keyboard, mobile viewport, draft conflict/quota, attachment restoration, routing/Back, deep links, and focus
- PWA install, direct offline routes, waiting-worker activation, cache cleanup, stale worker compatibility, and rollback
- V2 storage-key deletion: keys removed, contents never decoded or logged, idempotent across reloads
- Connection identity: canonicalization, base64url round-trip with the re-encode canonicality check, slug resolution across registered, tombstoned, unknown, and malformed cases, and Move re-keying with matching and mismatched `feedId`
- Transport verdicts per origin class, and the static, CORS-probe, and `no-cors`-retry diagnosis ladder
- XSS corpus, CSP, Trusted Types, unsafe URL schemes, diagnostics canary secrets, and IPC validation
- Locale parity and visual smoke for every release locale

Connection identity, slug encoding, transport verdicts, and tombstone precedence are pure functions, and they are where a wrong answer silently merges or orphans real user data. They get dense table-driven unit tests with no DOM. Slug resolution is covered by route tests over the real route tree and a memory history, following the pattern already in `packages/app-v3/src/app.test.tsx`. The management surface gets one React Testing Library test per distinct state, not a permutation matrix.

Tests use real implementations where practical. Recorded frame fixtures supplement but do not replace server integration. No cutover test may be quarantined. Runner-level retries may exist for infrastructure faults, but a test that only passes on retry is a cutover blocker: retries may not be used to mask known instability, and a flaky suite is treated as a failing suite in §12.4.

### 11.3 Error handling and diagnostics

Use app-shell, route, and message-part error boundaries. A failed part never blanks a transcript. Route failures preserve stale cached data when safe and expose an actionable recovery.

There is no third-party crash reporting, telemetry, or analytics. Diagnostics use an allowlist schema, never recursive object serialization. They may include versions, coarse platform, route kind without identifiers, connection state, frame types/counts, cursors, collection counts, operation names/ages/status, and sanitized stacks.

Diagnostics never include credentials, authorization headers, URL query/fragment values, raw server URLs, prompt/message/tool/file/diff content, outbox payloads, OAuth material, environment variables, or raw filesystem paths. IDs are hashed. Users preview the exact bounded report before copying. Golden tests seed Basic credentials, bootstrap codes, API keys, Unix/Windows paths, and prompt canaries.

The debug view shows safe summaries by default and requires explicit reveal for any sensitive local value. "Report a problem" never uploads automatically.

### 11.4 Performance budgets

Milestone 0 records the exact reference profile: device or emulator model, browser/version, viewport, DPR, CPU throttle, network, cache state, CI runner, server count, project/Session counts, and transcript/tool-output dataset. Budgets report p50 and p95 over at least 20 clean runs unless the benchmark documents another statistically valid sample.

Initial targets, confirmed or revised with recorded evidence before approval:

| Metric                                  | Target                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Initial shell JavaScript                | <= 200 KiB gzip, including everything required before shell interaction |
| Cold first contentful paint             | <= 1.5 s p95 on the reference profile                                   |
| Cold durability-ready                   | <= 3 s p95 including worker/WASM fetch, compile, and outbox init        |
| Warm cached-data interactive            | <= 500 ms p95                                                           |
| Resident route transition               | <= 50 ms p95; lazy asset fetch is measured separately                   |
| Composer input-to-paint while streaming | <= 16 ms p95, no task > 50 ms                                           |
| 500-message scroll while streaming      | >= 95% frames within budget and no gap > 100 ms                         |
| Reader-mode progressive render          | no task > 50 ms after initial route commit                              |

"Within budget" for the scroll metric means a frame produced within the reference display's frame interval: 16.7 ms at 60 Hz, and the measured interval on a higher-refresh reference device. The reference profile records which applies, since the same run passes or fails depending on it.

The initial shell budget is the tightest number in this table. React 19, TanStack Router, the TanStack DB core, and the shell's Radix primitives consume most of 200 KiB gzip before product code, so §11.5's split is a constraint on the shell's dependency list, not only on lazy loading.

Track main-thread JavaScript, persistence worker, WASM, diff worker, Streamdown/Shiki, locale, and terminal artifacts separately. A dynamic import is not excluded from user-visible performance merely because it is absent from the initial JS chunk.

### 11.5 Code splitting

- Initial shell: router, theme/locale bootstrap, connection shell, project rail, Session list, composer draft editing.
- Session: Streamdown core; `@streamdown/code` and Shiki languages load when code appears.
- On demand: diffs/worker, settings sections, onboarding, locale chunks, reader-mode support, terminal.
- Deferred after shell paint: persistence worker/WASM and outbox initialization, while durable mutation controls remain gated.
- Idle prefetch: only bounded likely-next assets, respecting data-saver and connection state.

The PWA precache policy in §10.1 and this split are one reviewed asset manifest, not independent assumptions.

---

## 12. Sequencing and gates

### 12.1 Milestone 0: sync and durability spine

Build the complete protocol and data layer behind a deliberately plain read-only Session list/transcript plus a minimal mutation harness.

- Generated collection manifest and public row schemas
- Server protocol additions the manifest depends on: durable todo IDs, a V2 MCP group, `locations`, and queued-input cancel/reorder with a queue revision
- Server additions the connection model depends on: the `GET /capabilities` response shape in §5.1, device-token issue/list/revoke, the single-use bootstrap-code exchange and its replay ledger, and removal of `?auth_token=`
- Server behavior changes in §3.4 and §10.1: the UI proxy fallback deleted, the silent port fallback removed, explicit response-header classes, and compression extended to raw bodies
- Feed metadata, transactional changelog coverage, receipts, and idempotency ledger
- Capability, stream resource, snapshot, rows, delta, reconnect, retention, and content endpoints
- Client connection agent, scoped cursors, multi-tab relay, persistence, eviction, and in-memory degradation
- Isolated per-server outboxes, mutation registry, dead-letter path, and create/prompt admission harness
- Runtime ingress validation and protocol/resource limits
- Protocol, persistence, outbox, multi-tab, security, and stability suites

Blocking evidence recorded in this document:

- Hand-written multiplexed sync survives reload and replacement snapshots without stale or missing rows.
- Snapshot/live races and multi-collection receipts converge under failure injection.
- One stream per server represents claims from multiple tabs; leadership handoff works under mobile throttling.
- Outbox executors have isolated storage/locks and never lose an accepted operation across process death.
- SQLite OPFS works in supported browser modes and the packaged Electron stable origin/partition.
- Quota/private-mode failure degrades visibly without failed boot or falsely durable writes.
- Cold shell and durability-ready budgets pass on the reference profile.
- Worker/WASM, CSP, service worker, and packaged builds work in dev and production.

If any foundation fails, Milestone 1 does not start. The persistence/transport decision returns to design review and this document remains provisional. In-memory degradation is not a substitute for the stable local-first acceptance criteria.

### 12.2 Milestone 1: product surface

Ship transcript, reader mode, composer/drafts, Session inputs, permissions/questions, project/Session navigation, search, attachments, review/files, settings, command/keybinding system, fork/revert/compaction/share, i18n, accessibility, notifications, diagnostics, and PWA install/update/offline shell.

The server-connection surface of §8.1 ships ahead of this milestone against a real persisted registry and a mocked probe, because the slug in §7.1 is a permanent URL contract and every other surface is built on top of it. Milestone 1 replaces the mock probe with the real §5.1 capabilities call and the real device-token flow; it does not revisit the identity, slug, or route decisions.

i18n arrives as one pass across the whole package rather than per feature. `packages/app-v3` is entirely hardcoded English today, and translating one feature would leave a single translated island while its copy — particularly the transport diagnostics of §10.3 — is still being reworded against real probe results. §12.4's parity gate is unaffected, since it fires before stable rather than before any individual slice.

### 12.3 Milestone 2: terminal and desktop completion

Ship terminal lifecycle, PTY ticket transport, desktop bridge disposition, native menus, deep links, updater, WSL, file capabilities, protected credential storage, packaged smoke tests, and the deferred packaged Electron origin (§3.4, §10.2).

### 12.4 Stable cutover gate

- Milestones 0-2 complete with recorded evidence
- Every dependent-package disposition in §3.2 complete, so the deletion change builds
- Zero open P0/P1 defects under a documented severity policy
- Protocol, persistence, outbox, routing, migration, browser E2E, accessibility, security, performance, and packaged desktop suites green
- All release locales at key/placeholder parity with visual smoke
- Real-device mobile keyboard, install, notification, and offline smoke complete
- V2 storage-key deletion verified against production-like fixtures, including malformed and absent blobs
- Mixed-version, service-worker update, upgrade, and rollback drills complete with pending work
- Hosted and server-embedded origins both verified against a real server, including the transport matrix in §10.3 on Chrome, Firefox, and Safari
- In-app diagnostics and report-a-problem path complete
- Named release owner approves the runbook and rollback artifact

There is no preview-channel feedback window, because §3.2 removed the preview channel. That gate line is deleted and not replaced; the remaining gates are the only thing between V3 and every user, and they are treated accordingly.

Only then does V3 replace V2 — taking `app.hena.dev` and the embed slot in one change per §3.2 — and delete `packages/app`, plus `packages/session-ui` once §3.2's dispositions for `packages/enterprise` and `packages/storybook` have landed.

---

## 13. Accepted tradeoffs

| Decision                         | Cost and mitigation                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| No tabs                          | Loses multi-Session keep-alive; fast list switching and explicit PTY detach remain                |
| Hard cutover, no preview channel  | Nothing softens the switch at `app.hena.dev`; §12.4's gates are the sole defense and the rollback artifact is rehearsed |
| Address as connection identity   | A server that moves changes its key; Move (§6.2) re-keys transactionally and refuses on a `feedId` mismatch |
| Base64url slug                   | URLs are unreadable; in exchange they are self-describing and resolve on a device that has never seen the server |
| Hosted origin rejects loopback HTTP | A laptop server is unreachable from `app.hena.dev`; the server-embedded origin serves that user instead |
| No V2 migration                  | Servers are re-added once; in exchange no first-load path ever decodes a V2 credential, and the plaintext blob is deleted |
| No Inbox                         | Cross-server pending work has no aggregate view; each route answers only to the server it names   |
| Rail scoped to one server        | Other servers' activity is not visible at a glance; they stay live and the connection control carries aggregate status |
| No crash reporting               | Field discovery depends on reports; diagnostics are local, safe, and required                     |
| Pre-1.0 persistence              | Foundation is version-fragile; exact pins and Milestone 0 gates block product work                |
| SQLite/OPFS                      | Adds worker/WASM cold cost; measured as durability-ready, not hidden from budgets                 |
| Offline-transactions dependency  | Wrapper owns isolation, typed retry, expiry, and dead letters around upstream rough edges         |
| Manual server entry              | Phone onboarding is rough; §10.3's diagnosis ladder makes errors specific rather than generic     |
| Local notifications only         | Suspended PWA is silent; no promise of background delivery                                        |
| RTL deferred                     | Arabic is beta, bidi content handling is still required, and the limitation is disclosed          |
| Curated themes                   | V2 custom themes are lost; QA surface remains bounded                                             |
| Streaming outside DB             | Two temporary sources of truth; ordered offsets and final revisions define reconciliation         |
| Streamdown                       | Less renderer control; performance and XSS corpora gate release                                   |
| Pierre Shadow DOM                | Ordinary theme selectors do not cross; matching themes and copy/selection tests are required      |
| No message-content search        | Historical semantic/content search remains unavailable and is not implied by UI copy              |
| Origin as profile boundary       | The same user can hold several profiles; the UI names the origin instead of implying data loss    |
| `style-src-attr 'unsafe-inline'` | Required by Radix/shadcn inline style attributes; bounded by `style-src 'self'` and Trusted Types |
| Share viewer left in V2          | V3 authors and revokes links but does not render them; enterprise migration is a cutover gate     |
| Attachment inlining              | Browser-picked files are bounded data URIs until an upload endpoint exists (§14 item 9)           |

---

## 14. Remaining validation items

These are experiments with explicit gates, not unspecified product behavior:

1. Record the exact shadcn preset contents and any source changes required for density, themes, CSP, and accessibility.
2. Record `@pierre/diffs` worker bundle cost, text selection/copy, forced-colors behavior, and phone long-line results.
3. Select and record changelog retention age/size from measured update volume.
4. Record Streamdown and `@streamdown/code` frame-time results under the fastest supported model stream.
5. Record the final reference device/profile, the reference frame interval, and approved performance numbers.
6. ~~Decide the exact browser protected-credential mechanism.~~ **Resolved in §10.3:** a revocable server-issued device token in IndexedDB under a non-extractable `CryptoKey`; the password is never persisted. The residual risk against live cross-site scripting is stated in §10.3 rather than hidden.
7. Decide whether full RTL graduates into V3 stable; otherwise keep Arabic explicitly beta.
8. Record `ghostty-web` commit pin, bundle and WASM cost, CSP interaction with §9.6, and resize/serialization behavior before Milestone 2 commits to it.
9. Decide whether V3 stable ships an attachment upload endpoint or keeps bounded inlining (§4.4); record the measured cost of inlined attachments in outbox and draft storage.
10. Verify that Cloudflare Workers Static Assets serves `index.html` for a base64url first segment under `not_found_handling: "single-page-application"`, and that `_headers` delivers the §9.6 CSP and the §10.1 cache classes unmodified.
11. Record device-token lifetime, refresh behavior, and revocation semantics, including what happens to a token whose server was reached by an address that later fails Move verification.
12. Record the measured false-positive rate of the `no-cors` reachability retry in §10.3 across Chrome, Firefox, and Safari, since an opaque success is inferred rather than observed.

Any change to a normative protocol, collection key, persistence version, mutation policy, or security boundary updates this document and its Korean translation in the same change.
