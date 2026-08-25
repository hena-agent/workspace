# Connect Web UI V3 to Server V3

Specification for replacing `packages/app-v3`'s mock data layer with a live connection to `packages/server-v3`: a TanStack DB sync engine over the collection stream protocol, optimistic mutations over Hono RPC, and the product surfaces wired to real data.

Status: approved design, produced from the design interview on 2026-08-25. Implementation lands as one integrated change.

Companion documents: `.agents/docs/en/web-ui.md` (the client spec) and `.agents/docs/en/new-server.md` (the server spec). This document implements the client half of that protocol for the current milestone and records every deviation in §14. Where this document and web-ui.md disagree, this document wins for this milestone and §14 explains why.

---

## 1. Scope and principles

### 1.1 Purpose

app-v3 is a complete UI shell rendering mock fixtures through synchronous functions in `src/mock/queries.ts`. server-v3 is a working sync server: capabilities handshake, stream resources, scoped snapshots, transactional `rows` frames, deltas, receipts, and an idempotency ledger. Nothing connects them. This milestone builds that connection so the product works end to end against a real server.

Two requirements are non-negotiable and shape everything below:

- Every mutation applies optimistically and executes immediately. No mutation waits for the server before the UI reflects it, and no mutation sits in a queue when the network is available.
- The data layer is TanStack DB for synchronized collections, TanStack Query for request-backed reads, and Hono RPC (`hc<AppType>`) for every HTTP call.

### 1.2 Principles

- In-memory first. Collections live in memory; every page load takes a fresh snapshot. Durability (OPFS SQLite, the offline outbox, startup gates, multi-tab leadership) is a later milestone layered on top of this working product. §14 records what that weakens and how the UI stays honest about it.
- The wire DTO is the source of truth. Collections store the exact server row encodings. View models are derived, never stored.
- Optimistic state drops only after authoritative state exists locally. A mutation resolves when its transaction is visible in synced collections, not when the HTTP response arrives.
- Failures restore intent where it was born. A failed prompt refills the composer. A failed reorder shows the authoritative queue. Nothing reduces user intent to a toast.
- The mock layer dies. Fixtures survive only as test seed data. No shipped code path imports `src/mock`.

### 1.3 Non-goals

- OPFS/SQLite persistence, `@tanstack/offline-transactions`, durable outbox, dead-letter UX
- Multi-tab coordination (each tab is independent; no BroadcastChannel, no leader election)
- The Move flow (§6.2 of web-ui.md); nothing meaningful exists to re-key yet
- Credentials, device tokens, bootstrap codes (server is auth phase 1, `auth: "none"`)
- The V2 to V3 cutover in `packages/hena` (route swap, embedded build, port rule)
- Service worker, PWA install, notifications, i18n port, Electron, share authoring, terminal
- `sessionDiffs`, review data, `mcpServers`, `serverCommands`, `skills`, `integrations` (server phase 2)

---

## 2. Decision summary

| Area                  | Decision                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Durability            | In-memory TanStack DB collections; fresh snapshot per load; no outbox                         |
| Row types             | Wire DTOs stored in collections; view models derived in live queries                          |
| Collection topology   | One collection instance per `(connection, collection, scope)`, lazily created, LRU retired    |
| Mutation ack          | `mutationFn` resolves after receipt plus txid observed in applied rows                        |
| Retry                 | Bounded auto-retry for network/5xx with the same idempotency key; typed conflicts fail fast   |
| Concurrency           | Focused server holds the live stream; other registered servers get capability probes         |
| Online-only ops       | Permission/question replies and interrupt are optimistic with rollback                        |
| List badges           | Server adds derived `working` to the sessions row; unread is a client watermark dot           |
| Streaming text        | Per-part external store, `useSyncExternalStore`, rAF-coalesced; never written into collections |
| Registry              | Real localStorage registry: add with probe diagnosis, switch, remove, tombstones, self-seed   |
| Phase-2 surfaces      | Honest empty states; new bounded `GET /api/fs/read` so the files preview works                |
| Create session        | Client-generated IDs, optimistic rows, navigate immediately, roll back to draft on failure    |
| Validation            | Effect Schema for envelope and control plane; rows cast after envelope validation             |
| Settings              | `defaultAgent`, `defaultModel`, `queueDelivery` sync via `settings.replace`; theme stays local |
| Scope lifecycle       | Focused transcript plus LRU linger (8 sessions); stream never suspends while the tab is hidden |
| Queue management      | Visible queued group, optimistic cancel, move up/down buttons over `ReorderInputs`            |
| Failure UX            | Inline restoration at the intent's home; fallback toast only when the home is unmounted       |
| Testing               | In-process real-server integration, seeded component tests, Playwright E2E with a real model  |
| E2E model             | `opencode-go/ox-alpha-free`; local auth store locally, `OPENCODE_GO_AUTH_JSON` in CI          |
| Dependencies          | Latest stable TanStack, exact-pinned (§3.1); the web-ui.md §1.4 audited set does not apply    |
| Delivery              | Single integrated change; server additions are part of it                                     |

---

## 3. Dependencies and layout

### 3.1 Dependencies

`packages/app-v3` gains exact-pinned runtime dependencies:

| Package                  | Version    | Role                                        |
| ------------------------ | ---------- | ------------------------------------------- |
| `@tanstack/db`           | `0.8.2`    | Collections, live queries, transactions     |
| `@tanstack/react-db`     | `0.3.2`    | `useLiveQuery` bindings                     |
| `@tanstack/react-query`  | `5.101.4`  | Request-backed reads (`fs.*`, content)      |
| `hono`                   | `catalog:` | `hc<AppType>` typed client                  |
| `effect`                 | `catalog:` | Schema validation in the deferred sync chunk |
| `@hena/schema`           | `workspace:*` | Wire DTO types and `Sync` runtime schemas |
| `@hena/server-v3`        | `workspace:*` | `AppType` (type-only import)              |

Versions were current stable at spec time; re-resolve to latest stable at implementation and record the final numbers here. The audited set in web-ui.md §1.4 existed for persistence interop, which this milestone does not exercise; the persistence milestone re-audits the full set when it lands.

Dev dependencies add `@playwright/test`.

Layering: `AppType` is imported with `import type` only, so no server code reaches the client bundle. Runtime schema imports come from `@hena/schema/sync` (browser-safe) and load in a deferred chunk with the sync engine. Nothing in app-v3 imports `@hena/core`.

### 3.2 Layout

New code lives in app-v3, not a new package; there is one consumer.

```text
src/connection/registry.ts     localStorage registry, tombstones, probes
src/connection/agent.ts        per-server connection agent (stream, collections, deltas, waiters)
src/connection/provider.tsx    React context: registry + focused agent
src/sync/                      SSE client, frame validation, snapshot/rows application, cursors
src/mutations/                 one module per operation class (optimistic apply + mutationFn)
src/data/                      live-query hooks and view-model derivation (replaces src/mock/queries.ts)
```

`src/lib/server-url.ts` (canonicalization, slug encode/decode) stays and becomes the registry's key derivation. `src/lib/types.ts` becomes the derived view-model layer: same type names where the shape survives, fields recomputed from wire DTOs.

---

## 4. Server additions

Two additions to server-v3 ship inside this change. Both are additive; a rolled-back server ignores them.

### 4.1 `working` on the sessions row

The session list must show which sessions are running without subscribing to their transcripts. Nothing in `Session.Info` carries that, and deltas only flow for subscribed scopes, so the client cannot derive it. The sessions collection row gains a derived boolean:

```ts
{ ...encoded Session.Info, working: boolean }
```

The collection projector already re-projects the session row on every durable session event, so the field recomputes at no extra trigger cost. The contract, which tests must prove rather than the derivation formula:

- `working` is true from prompt admission with steer delivery (or promotion of a queued input) until the drain reaches completion, error, or interruption.
- After completion, error, and interruption, `working` is false.
- `bootstrapCollections` clamps `working` to false at process start; a fresh process has no drains, so a crash can never leave a stuck true.

The suggested derivation is: the newest message is a `user` message awaiting response, or the newest `assistant` message lacks `time.completed`; interrupt and failure paths must finalize the in-flight message so the predicate flips. If they do not, the implementation adjusts the derivation, not the contract.

This changes the sessions row DTO; the client validates against the extended shape, and a future web-ui.md §4.1 amendment records it.

### 4.2 `GET /api/fs/read`

v1 has `fs.list` and `fs.find` but no way to read a file, which leaves the files tab's preview pane dead. One bounded route fixes it, following the existing filesystem route pattern (`Sync` query schema, path traversal guards identical to `FileListQuery`, `Cache-Control: no-store`):

```text
GET /api/fs/read?directory&workspaceID&path&offset&limit
```

- `path` is required and validated by the same relative-path pattern as `fs.list`.
- `offset`/`limit` are byte-addressed; `limit` caps at 256 KiB (the §4.4 full-content page bound).
- Response: `{ text, totalBytes, truncated }` for text content, `{ binary: true, totalBytes }` when the first page fails UTF-8 decoding or contains NUL bytes. Binary content is never inlined.
- Errors reuse the filesystem route mapping: `not_found` for missing paths, `validation` for escapes and non-files.

Review file reads, references, and symbols stay phase 2; this route serves the files tab only.

---

## 5. Connection registry

`MockServerProvider` is deleted. Its replacement is real client-owned state per web-ui.md §8.1's first slice, minus Move.

### 5.1 Storage

localStorage, bounded, versioned:

- `hena.connections.v1`: ordered array of `{ url, name?, addedAt }` where `url` is the canonical base URL from `server-url.ts`. The URL is the identity; there is no separate id.
- `hena.tombstones.v1`: array of canonical URLs removed from this profile.

### 5.2 Slug resolution

Every route resolves its `$connectionId` param (the param name stays; its value is the base64url slug of the canonical URL) in the order web-ui.md §7.1 defines:

1. Registered: render.
2. Tombstoned: a "you removed this server" screen with an explicit re-add action. Re-adding clears the tombstone.
3. Unknown: a blocking confirmation gate naming the decoded address and its probe verdict. Accepting registers permanently and continues to the deep-linked route.
4. Malformed (round-trip check fails): a route error.

### 5.3 Adding a server

The add flow and the unknown-slug gate share one probe with the three-stage diagnosis from web-ui.md §10.3:

1. Static checks on the two URLs. In dev and on an embedded origin, loopback plain HTTP is allowed; a hosted HTTPS page rejects plain HTTP outright.
2. `GET /api/collection/capabilities`. Any HTTP status means reachable. `auth: "required"` shows "this build does not support password-protected servers yet" and refuses to register; server-v3 phase 1 cannot serve such a server anyway. A protocol range that excludes 1 shows an upgrade-required message.
3. On opaque failure, one `mode: "no-cors"` retry. Success means CORS rejection, and the message names the exact origin to add and the `server.cors` config key. Both probes failing means unreachable-or-certificate, with an open-in-new-tab remedy.

### 5.4 Self-seeding

When `import.meta.env.DEV` (Vite proxies `/api` to server-v3, so the page origin is a server) or `VITE_HENA_EMBEDDED` is set, the page origin seeds into the registry at boot as the profile's own server, with Remove disabled, exactly as web-ui.md §8.1 requires for embedded origins.

### 5.5 Probes and status

Non-focused registered servers get lightweight `capabilities` probes: at app start, when the connection surface opens, every 60 seconds while it stays open, and on window focus. Probe results feed per-connection status: `self`, `reachable`, `unreachable`, `auth-unsupported`, `upgrade-required`. The focused server's status comes from its live stream state instead. The titlebar connection control shows the focused server's name and escalates its badge to the worst status across all connections, per web-ui.md §8.1.

### 5.6 Removal

Remove wipes that URL's localStorage state (watermarks, drafts scoped to it), drops its in-memory agent if focused, and writes a tombstone. With no outbox there is no pending-work drain; an in-flight optimistic mutation belonging to that server is allowed to finish or fail before the agent disposes.

---

## 6. Connection agent

One agent per canonical URL, created for the focused server, disposed on server switch. The agent owns the RPC client, the stream, the collection instances, cursors, the delta store, and txid waiters. It is plain TypeScript with no React imports; `provider.tsx` binds it into context.

### 6.1 RPC client

`hc<AppType>(baseUrl)` with a fetch wrapper that adds `x-correlation-id`. No auth header in phase 1. Every HTTP call in the app goes through this client; hand-written `fetch` exists only inside the SSE reader and the probe module.

### 6.2 Stream lifecycle

The server's implemented contract, which the engine follows exactly:

1. `GET /api/collection/capabilities`: verify protocol 1 is inside `{min, max}` and `auth` is `"none"`.
2. `POST /api/collection/streams`: yields `{ streamId, generation, expiresAt, feed: { feedId, runtimeId, retainedFloor }, subscriptionRevision }`.
3. `PUT /streams/:id/subscription` with complete desired state: `{ revision, lists: true, sessions: [claimed scope IDs], cursors }`. Cursor keys are `${collection}:${scopeKey}`.
4. `GET /streams/:id/events`: fetch-based SSE. The reader parses `event:`/`data:` lines from the response body; `EventSource` is not used.

A subscription PUT disconnects the current attachment (the server registry calls `disconnect` on subscribe). This is the designed way to change scopes: PUT the new desired state with cursors for every scope already synced, let the SSE end, and re-attach. The engine must not treat that disconnect as a failure and must not back off before re-attaching. Each attachment increments `generation`; frames from a superseded generation are discarded.

On re-attach, scopes whose cursor names the current `feedId` and sits inside `[retainedFloor, baseSeq]` skip the snapshot and receive replayed transactions; scopes without a valid cursor receive a replacement snapshot. This makes claim changes cheap.

Stream resources expire five minutes after disconnect. A 404 from `GET /events` or the subscription PUT means the resource is gone: create a new stream, PUT the full desired state with held cursors, attach.

### 6.3 Liveness and reconnect

A liveness timer resets on every received frame; 45 seconds of silence (three 15-second heartbeats) kills the connection. Reconnect uses jittered exponential backoff from 1 to 60 seconds and re-attaches with cursors. `slow_consumer` reconnects the same way. `subscription_revision_conflict` restarts from `POST /streams`. `unsupported_protocol`, `unauthorized`, and malformed frames are terminal: the connection enters an error state surfaced in the connection control, and only user action (or a changed probe result) retries.

The stream stays connected while the tab is hidden. There is no suspend state; badges and lists remain live in background tabs.

### 6.4 Feed and runtime changes

- A frame with an unknown `feedId` (database replaced): drop every collection and cursor for this connection and restart from the handshake.
- `runtimeId` change (server restart): expected; the server re-sends volatile snapshots on attach, and durable cursors remain valid under the same `feedId`.
- A `snapshot_required` error or a cursor below `retainedFloor`: drop the affected scopes' cursors and re-PUT so those scopes re-snapshot.

### 6.5 Frame validation

Effect Schema (from `@hena/schema/sync`, loaded with the deferred sync chunk) decodes the capabilities response, stream-create response, receipts, error envelopes, the frame envelope (`protocolVersion`, `feedId`, `runtimeId`, `streamId`, `generation`, `subscriptionRevision`, `type`), and delta frames. Row payloads inside `snapshot.page` and `rows` are cast to their DTO types after envelope validation; the server schema-enforced them at emit time. A frame that fails envelope validation is `malformed_frame` and terminal.

### 6.6 Applying snapshots and rows

Each collection instance is a `createCollection` with a custom sync implementation using TanStack DB's sync interface (`begin`/`write`/`commit`/`markReady`).

- Snapshot: buffer `snapshot.page` rows keyed by `snapshotId`; on `snapshot.end`, verify the key count, then in one `begin`/`commit`: upsert every snapshot row and delete every present key absent from it. `markReady` fires after the first snapshot (or empty snapshot) completes. `baseSeq` must equal `throughSeq`; a mismatch is a protocol error.
- Rows: one frame carries whole transactions in sequence order. Apply all changes across every affected collection instance in a single synchronous block (no awaits between collection commits) so React never paints an intermediate combination. `op: "reset"` (empty `rowKey`) truncates the scope; the server always follows it with a replacement snapshot, which is how oversized transactions arrive.
- Keys: `parts` and `models` row keys arrive as JSON arrays; the collection key is `JSON.stringify(array)`, matching the server's storage key. No code assumes a single `id` field.
- Cursors: after applying a frame, advance the in-memory cursor of each affected scope to the frame's `throughSeq`. Cursors are what re-PUTs and re-attachments send.
- Buffered deltas and rows that arrive during a snapshot apply only when their `seq` exceeds the snapshot's `throughSeq`, which the server already guarantees by its own buffering; the client still guards.

### 6.7 Scope claims

Route loaders register non-awaited claims for the session scopes they render. The agent keeps the focused session's four scopes (`messages`, `parts`, `sessionInputs`, `todos`) subscribed plus an LRU of the last 8 visited sessions. Eviction beyond the cap drops the scopes from the subscription (PUT, re-attach), disposes the collection instances, clears their delta entries, and forgets their cursors. Lists (`lists: true`) are always on for the focused server.

### 6.8 Txid waiters

The agent exposes `awaitTxid(txid, timeoutMs)`. Every applied `rows` frame records the txids it carried; a waiter resolves once its txid has been applied (or was already applied; the agent keeps a bounded set of recent txids, 256 entries, to absorb receipt-before-frame ordering). On timeout the agent drops the affected scopes' cursors and forces a re-snapshot, then resolves. Default timeout 10 seconds.

---

## 7. Collections and view models

### 7.1 Collection instances

Per connection:

| Scope    | Collections                                             | Instance                             |
| -------- | ------------------------------------------------------- | ------------------------------------ |
| Instance | `projects`, `sessions`, `locations`, `permissions`, `questions` | one each, created with the agent |
| Location | `agents`, `models`, `providers`, `settings`             | one per Location key, created when a surface needs that catalog |
| Session  | `messages`, `parts`, `sessionInputs`, `todos`           | one per claimed session (§6.7)       |
| Profile  | `settings` (scope `profile`)                            | one                                  |

`permissions`, `questions`, `agents`, `models`, and `providers` are volatile: they arrive as source-revisioned replacement snapshots, never in the changelog, and reset on server restart. The engine treats their snapshots identically to durable ones; only cursor handling differs (they have none).

### 7.2 View models

`src/data` replaces `src/mock/queries.ts` with live-query hooks plus small pure mappers. Components keep their props. The notable derivations:

- Project: `name ?? basename(worktree)`, `path = worktree`, `updatedAt = time.updated`, color from `icon.color`.
- Session list: filter `projectID`, exclude `time.archived`, sort `time.updated` descending. `status` derives in order: `permission` when the instance-scoped `permissions` collection has a row with this `sessionID`, `question` likewise, `working` from the row's `working` field, else `idle`. `unseenCount` becomes a boolean unread dot: `time.updated` newer than the local watermark (§11.2). The rail's project notification aggregates these per project as today.
- Transcript: messages ordered by `time.created` with id tiebreak; parts filtered by `messageID`, ordered by `ordinal`. Assistant rows join their parts; other message types render from the message row alone.
- Queue: `sessionInputs` rows without `promotedSeq`, ordered by `queuePosition`.
- Docks: oldest pending permission/question row for the focused session.
- Catalogs: `agents`/`models`/`providers` for the focused session's Location key, which is `JSON.stringify({ directory, workspaceID? })` exactly as the server builds it. `models` keys are `[providerID, id]` arrays on the wire.

### 7.3 Request-backed reads

Plain TanStack Query, per-connection query keys prefixed by the canonical URL:

- `fs.list` for the files tree (per-directory queries, loaded per expanded node).
- `fs.find` for composer mention search, debounced and cancelled via query cancellation.
- `fs.read` for the file preview pane.
- `content/:contentId` pages for truncated tool output, `cache: "no-store"` semantics via `gcTime: 0`.

web-ui.md's tier-2 (`queryCollectionOptions`) distinction is deliberately collapsed into tier 3 for this milestone; §14 records it.

---

## 8. Optimistic mutations

### 8.1 Lifecycle

Every mutation is a TanStack DB optimistic action: a synchronous `apply` writing to collection instances, and a `mutationFn` that persists it. The overlay drops when `mutationFn` resolves and rolls back when it throws.

`mutationFn` for queueable operations:

1. Build the request with a UUID idempotency key, generated once per intent and reused across every retry.
2. Call the typed route via `hc`. Classify the outcome by the typed error envelope.
3. Transient failures (network error, 5xx, 429) retry with jittered backoff, three attempts across roughly eight seconds, same key. The optimistic overlay stays visible throughout; it is still pending.
4. Non-retriable outcomes (`validation`, `idempotency_conflict`, `revision_conflict`, `payload_too_large`, `not_found`, `conflict`, `unauthorized`, `upgrade_required`) throw immediately.
5. On a receipt (`applied`, `noop`, or `exact_retry` all count as success), `await agent.awaitTxid(receipt.txid)` so authoritative rows exist before the overlay drops. No flicker window.

Online-only operations (permission reply, question reply, interrupt) skip idempotency keys and receipts. Their `mutationFn` resolves on HTTP success once the synced volatile state reflects the resolution: the reply routes trigger an immediate volatile snapshot broadcast, so the engine waits (bounded, 5 seconds) for the request row to disappear from synced state before resolving, closing the same flicker window without txids.

### 8.2 Operations

| Operation        | Route                                        | Optimistic apply                                                                 | On failure                                                            |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Create session   | `POST /api/session`                          | Insert sessions row (client `Session.ID.create()`, `working: true`) and user message row (client `SessionMessage.ID.create()`); navigate to the transcript immediately | Rows roll back; return to the draft route with prompt text intact and an inline error |
| Admit prompt     | `POST /api/session/:id/prompt`               | Steer: insert user message row, bump session `time.updated` and `working`. Queue: insert `sessionInputs` row at the end position | Composer refills with the text; inline error                          |
| Cancel input     | `POST /api/session/:id/input/:inputId/cancel` | Delete the `sessionInputs` row; carries `expectedRevision` from the session row's `queueRevision` | Row reappears; `revision_conflict` shows the authoritative queue with an item-level notice |
| Reorder inputs   | `PUT /api/session/:id/input-order`           | Rewrite `queuePosition` locally; send the complete `messageIDs` order plus `expectedRevision` | Authoritative order restores with a notice                            |
| Replace setting  | `PUT /api/settings/:scope/:key`              | Update the settings row locally with `expectedRevision` from the row revision    | Field shows `conflicted` with the authoritative value; the attempt stays editable |
| Interrupt        | `POST /api/session/:id/interrupt`            | Set an ephemeral per-session "stopping" flag in the agent (no collection write); cleared when `working` flips false or after a timeout | Flag clears with an inline notice; idle interrupt is a success no-op  |
| Permission reply | `POST /api/permission/:id/reply`             | Optimistic delete of the volatile row; the dock resolves instantly               | Row reinstates with a notice; a divergent `already_resolved` shows the authoritative resolution without an error tone |
| Question reply   | `POST /api/question/:id/reply`               | Same as permission reply                                                         | Same                                                                  |

Prompt payloads (`PromptInput.Prompt`) carry the composer's agent/model selection and file mentions as URIs. Client-held attachments inline as bounded data URIs within the §4.4 limits; over the limit, the composer refuses with the reason.

The transcript renders optimistic user messages with a subtle pending affordance until synced; the affordance is visual only and never blocks interaction.

### 8.3 Failure surface

Restoration is inline at the intent's home per the table above. A single toast utility covers exactly one case: the mutation's home surface is no longer mounted when it fails (the user navigated away mid-flight). The toast names the operation and offers retry with the same idempotency key. There is no failed-work center in this milestone; nothing durable exists to hold one.

Because collections are in-memory, closing the tab abandons in-flight retries. The composer never claims otherwise: there is no "queued offline" language anywhere in this milestone, and a send attempted with no connectivity fails after the retry budget with restoration, stated plainly.

---

## 9. Streaming deltas

Delta frames (`{ sessionId, messageId, partId, partKind, offset, text }`) never touch collections. The agent keeps a per-connection delta store:

- Keyed by `(messageId, partKind, partId)` within a session entry. Values hold accumulated text, the accumulated UTF-8 byte length, and a gap flag.
- A frame whose `offset` equals the accumulated byte length appends. An offset entirely behind is a duplicate and is dropped. An offset ahead sets the gap flag; the store keeps what it has and the UI shows an incomplete marker until the final row arrives.
- Notifications coalesce per animation frame. Components subscribe with `useSyncExternalStore` scoped to one part, so token streaming re-renders only the streaming part's subtree.
- Finalization: when the authoritative `parts` row for `[messageId, "tool"|"text"|"reasoning", partId]` applies (or the compaction `messages` row, whose delta identity is the message id with kind `compaction`), the store entry clears in the same synchronous block that commits the row. Final rows always win by revision.
- Old-generation frames and frames for unclaimed sessions are discarded. Evicting a scope clears its entries.

Rendering preference per part: final row text when present, else delta store text, else nothing. `tool-input` deltas render inside the pending tool row's input preview.

---

## 10. Product surface wiring

### 10.1 Session transcript

The transcript reads the §7.2 view model. The `working` flag plus absence of streaming parts renders the lightweight thinking indicator; no fabricated assistant rows exist. Truncated content rows (`truncated: true` with a `content` ref) render the bound plus a "show full output" action fetching `content` pages via §7.3. Unknown message or part types render the bounded forward-compatible fallback web-ui.md §8.2 requires.

### 10.2 Composer

Send behavior, agent/model pickers, and Enter semantics stay as built. New wiring: pickers list the Location-scoped catalogs; defaults resolve from the `settings` collection (§10.4) then the session row's `agent`/`model`; send dispatches admit-prompt (steer) or queue per modifier; the stop control dispatches interrupt while `working`. The queued group renders `sessionInputs` with per-item cancel and move up/down buttons issuing the full-order reorder. Buttons are keyboard-accessible by construction; drag-and-drop arrives later as an enhancement over the same mutation.

### 10.3 Permission and question docks

Docks bind to the volatile rows and reply optimistically per §8.2. Replies carry the row's `sessionID`, `nonce`, and `location`, which the volatile rows already include. A dock whose row vanished by another actor's reply resolves silently; `already_resolved` with a different outcome shows the authoritative resolution.

### 10.4 Settings

`defaultAgent`, `defaultModel`, and `queueDelivery` read and write the Location-scoped `settings` collection through the replace mutation with field-level `clean`/`dirty`/`saving`/`saved`/`conflicted` states. Theme and notification preferences stay in localStorage and never touch the server; the server's `theme` settings key goes unused by this client. Providers and models sections become read-only views over their collections. The MCP section renders the not-supported empty state.

### 10.5 Files

The tree loads per-directory through `fs.list` against the focused session's (or project's) Location. Preview uses `fs.read`, renders text with binary/oversize fallbacks, and states plainly when content is unavailable. Find-in-project input uses `fs.find`.

### 10.6 Review

The review tab renders an explicit "not supported by this server yet" state. No mock diffs ship.

### 10.7 Command palette

Sessions and projects search over synchronized rows. Server switching lists registered connections from the registry. The server-commands group renders its empty state.

### 10.8 Route states

Views distinguish, minimally: connecting (no snapshot yet), live, reconnecting (after 30 seconds stale, show last-sync age), unreachable, unsupported (auth or protocol), and not-found (id absent after sync is ready). Loaders never await API data; they resolve the slug and start claims.

---

## 11. Client-local state

All bounded, versioned, keyed under the canonical URL where server-scoped.

### 11.1 Registry and tombstones

§5.1.

### 11.2 Seen watermarks

`hena.seen.v1.<slug>`: map of session id to last-seen `time.updated`, written when a transcript is focused, capped at 500 entries LRU. Drives the unread dot.

### 11.3 Drafts

One localStorage draft store replaces web-ui.md §6.9's two-store design for this milestone: a versioned index plus bodies (text, selection, agent/model, delivery mode) for `/new/:draftId` routes and per-session composer drafts. Attachment bytes do not persist; a draft restores text and metadata only, and the composer says so when chips are dropped on reload. Schema changes migrate, never reset.

---

## 12. Development topology

- server-v3: `bun dev` on `127.0.0.1:4106`. Its CORS allowlist already includes the Vite origins.
- app-v3: `bun dev` on 5173 with the Vite proxy (`vite-proxy.ts`) forwarding `/api` to `http://127.0.0.1:4106`. Development is same-origin; the app self-seeds the page origin per §5.4, so the daily loop needs no connect step.
- `bun run build` then serving `app-v3/dist` through server-v3's static routes exercises the embedded-origin path; server-v3 already points its default `publicDir` there.

---

## 13. Testing

Three tiers, all runnable from package directories.

### 13.1 Sync engine integration (app-v3, `bun test`)

The engine runs against the real server in-process: `createApp` with a temp SQLite database (reusing server-v3's fixture approach) and, where mutations need core, `createCoreDomain` with a temp data dir. The `hc` client and the SSE reader bind to `app.request`/`app.fetch`; Hono returns real streaming Responses, so no network exists.

Coverage: handshake and protocol/auth refusal, snapshot application including key-count validation and replacement deletes, buffered replay ordering, the PUT-disconnect-reattach dance, cursor resume across reattach and across stream expiry, `reset` plus recovery snapshot, generation supersession, `feed_replaced` wipe, `awaitTxid` resolution and its timeout re-snapshot, delta contiguity and gaps across multibyte content, and the full optimistic lifecycle per §8.2 row including retry classification (injected failing fetch) and rollback restoration.

### 13.2 Component tests (app-v3, `bun test` with happy-dom)

Existing RTL tests migrate from `src/mock/queries.ts` imports to a harness that creates in-memory collection instances seeded with fixture data re-typed to wire DTOs. Fixtures move under test scope. Assertions stay behavioral; no component imports the sync engine directly.

### 13.3 Playwright E2E (app-v3, `bun run e2e`)

The harness starts an unmodified server-v3 (`start()` with a temp data dir and test port) and the built app, and drives a real browser through the real product against the real model `opencode-go/ox-alpha-free`, which is free of charge:

- Locally, credentials come from the developer's existing opencode-go auth store.
- In CI, the `OPENCODE_GO_AUTH_JSON` secret (the same entry `_review-model.yml` maps for the `opencode-go` provider) is materialized into the harness's auth location before the suite runs.
- When no credentials resolve (fork PRs), the model-dependent tests skip with a named reason; registry, navigation, and non-LLM mutation tests still run.

Because the model is real, assertions tolerate nondeterminism: prompts are crafted for stability ("Reply with exactly: pong"), and tests assert completion, streaming visibility, and state transitions rather than exact text. Timeouts are generous and the suite stays smoke-sized (roughly ten flows): add/switch server, create session with live streaming to completion, steer versus queue, queue cancel and reorder, interrupt, a permission flow (fixture agent config with ask-level bash permission), settings save and conflict, files tree and preview, and the phase-2 empty states.

---

## 14. Recorded deviations from web-ui.md

Each is deliberate for this milestone, and each names its return condition.

1. In-memory collections; no OPFS, outbox, startup gates, or multi-tab leadership. "Durable acknowledgement" weakens to optimistic-plus-bounded-retry, and the UI never uses queued-offline language. Returns with the persistence milestone, which re-runs web-ui.md's Milestone 0 gates.
2. Only the focused server streams (web-ui.md §6.5 wants all registered servers live). Background servers get capability probes; the worst-status escalation stands. Returns with persistence, when shared storage makes N live streams per profile worth their cost.
3. Registry ships without Move. Returns when per-server state grows beyond localStorage trivia.
4. Online-only operations render optimistically with rollback instead of pending-disabled. This follows this milestone's core requirement; if reappearing docks prove confusing in practice, individual operations may move to pending-disabled with a recorded reason.
5. Tier 2 (`queryCollectionOptions`) collapses into plain TanStack Query for `fs.*` and content. Returns if a surface needs live-query composition over request results.
6. The sessions row gains a derived `working` field (manifest change, §4.1 amendment pending).
7. `fs.read` joins the v1 read surface (new-server.md §7 amendment pending).
8. `unseenCount` degrades to an unread dot from a client watermark.
9. Dependencies use latest stable exact pins, not the §1.4 audited set, whose persistence rationale does not apply here.
10. Drafts collapse to one localStorage store; the draft-index/durable-body split returns with persistence.
11. No preview channel, service worker, notifications, or i18n work; unchanged from the package's current state and out of scope here.

---

## 15. Deletions

Complete before the change merges:

- `src/mock/queries.ts` and `src/features/server/mock-server-provider.tsx` are deleted; no shipped module imports `src/mock`.
- `src/mock/fixtures.ts` moves into test scope, re-typed to wire DTOs where seeds need them.
- `src/lib/types.ts` keeps only types that remain true as derived view models; fields that no longer exist (`unseenCount` as a number, `Connection.id`) are removed with their consumers updated.

---

## 16. Open items

1. Measure the deferred sync chunk (Effect Schema plus engine) against web-ui.md §11.4's budget once wired; fall back to narrow structural guards for frames only if it blows the budget, decided with numbers.
2. Audit `working` for stuck states under interrupt and provider-failure paths once implemented; the §4.1 contract tests are the gate.
3. Record real reattach cost (PUT-disconnect-reattach with cursors) under transcript-heavy sessions; if it measures badly, propose in-place subscription updates as a server change.
4. Decide session archive/rename/delete mutations when core exposes them; the session list currently offers no affordance it cannot honor.
5. Revisit deviation 4 (optimistic online-only ops) after real use.
6. Write the web-ui.md and new-server.md amendments (deviations 6 and 7, with Korean translations) as the follow-up documentation change.
