# Server V3

Specification for `packages/server-v3`, the Hono server that replaces `packages/server` and serves `packages/app-v3` exclusively.

Status: provisional design, produced from the design interview on 2026-08-23. It becomes approved when the v1 test suite in §10 passes and the web-ui.md amendments in §13 land.

Companion document: `.agents/docs/en/web-ui.md` (the client spec). This document implements its §4 and §5 with the recorded deviations in §5.7 below. Where the two disagree, this document is wrong until §13 says otherwise.

---

## 1. Scope and principles

### 1.1 Purpose

`packages/server` is an Effect HttpApi layer over `@hena/core`. It serves a request/response protocol that app-v3 cannot build on: no changelog, no cursors, no receipts, no idempotency. Web UI V3's data layer is TanStack DB with a custom sync adapter, and it needs a server that treats synchronized collections, durable mutation receipts, and streaming deltas as the primary protocol rather than an event feed bolted onto REST.

Server V3 is a complete replacement, not an addition:

- It is built exclusively for app-v3. No other client is a design input.
- The old HTTP protocol dies with `packages/server`. The TUI, the generated `@hena/client` SDK, plugins, and the enterprise share viewer lose their server at cutover and must adopt the new protocol or be retired. This is accepted, recorded in §12, and not softened.
- `@hena/core` stays. Session execution, LLM orchestration, tools, permissions, and persistence are core's job. Server V3 is the HTTP, sync, and durability layer over it.
- Type safety to the client comes from Hono RPC (`hc<AppType>`), not code generation. `bun run generate` and `packages/client` have no role in the V3 loop.

### 1.2 Principles

- One SQLite transaction is the unit of truth. A domain write, its changelog rows, its idempotency record, and its receipt all commit together or not at all.
- The wire carries public DTOs only. Core rows, catalog objects, and internal errors never leave the process.
- Every guarantee has a cheaper escape hatch that is still correct. A transaction too large to frame becomes a scoped reset plus snapshot; a lost response is recovered by idempotent replay, not by a lookup service.
- Simplifications are recorded, not silent. §5.7 lists every place this server deviates from web-ui.md §5, and §13 lists the amendments that make the two documents agree.
- The server is honest about phases. Capabilities report what is actually implemented; the client is never left probing.

### 1.3 Stack

Hono on `Bun.serve`, single process. Effect Schema end to end: route validation through `@hono/standard-validator` (Effect Schema implements Standard Schema), public DTO and frame schemas shared with the client. Domain access through one Effect `ManagedRuntime` built at boot. Storage is core's existing Drizzle/SQLite database (WAL mode, `packages/core/src/database/database.ts`); server V3 adds tables via core migrations, never a second database file.

---

## 2. Decision summary

| Area                | Decision                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Domain layer        | New Hono layer over `@hena/core`; `packages/server` abandoned                             |
| Client scope        | app-v3 only; complete replacement; old protocol dies at cutover                           |
| Protocol fidelity   | web-ui.md §5 shape with four recorded cuts (§5.7)                                         |
| Changelog           | Transactional emitter inside core write paths, same SQLite transaction                    |
| Programming model   | Plain async TS handlers; one `ManagedRuntime` bridge at the core boundary                 |
| Wire schemas        | Effect Schema everywhere; DTOs live in `packages/schema`; served to client via `./protocol` |
| Client RPC          | Hono RPC (`hc<AppType>`); no OpenAPI, no generated client                                 |
| Package             | `packages/server-v3`, own dev entry; `hena serve` swaps at cutover                        |
| Auth                | Phase 1 `auth: "none"` only; phase 2 device tokens and bootstrap codes                    |
| v1 collections      | Core-loop set (§4.3) plus durable todo ID migration and new `settings` collection         |
| v1 mutations        | Full web-ui.md §6.6 allowlist, including queued-input cancel/reorder with queue revision  |
| v1 reads            | Full-content paging plus `fs.list`/`fs.find`                                              |
| Dev topology        | Vite proxies `/api` to server-v3; dev is same-origin                                      |
| Embedded UI         | v1 serves `app-v3/dist` with §10.1 header classes and compression                         |
| Testing             | Protocol conformance, per-collection changelog audit, ledger crash points                 |
| Cutover             | One change in `packages/hena`: route swap, port rule, `?auth_token=` removal, proxy deletion |

---

## 3. Architecture

### 3.1 Package and layering

The package is `packages/server-v3`, named `@hena/server-v3`. Runtime dependency direction follows the repo rule: Schema, then Core, then Server.

- `packages/schema` gains a `sync` module: public collection row DTOs, the changelog operation type, frame schemas, receipt and error types. Both core (the emitter) and server-v3 (the wire) import from here, so a DTO change is one edit.
- `packages/core` gains the changelog emitter service and the new tables (§4.1, §4.5) via its normal migration path.
- `packages/server-v3` owns routing, streams, snapshots, the idempotency ledger logic, static serving, and CORS.

Exports:

- `@hena/server-v3` is the server entry (route tree, `Bun.serve` wiring).
- `@hena/server-v3/protocol` exports `AppType` for `hc`, plus the frame and DTO schemas app-v3 uses for trust-boundary validation. app-v3 imports `AppType` as a type-only import; runtime schemas load in the client's deferred sync chunk, and their measured bundle cost is recorded before cutover (web-ui.md §11.4 budget applies to the client, not this package).

### 3.2 Effect boundary

Core stays Effect; the server does not. At boot, server-v3 builds the same LayerNode service graph the old server builds (`Database`, `EventV2`, `SessionV2`, `SessionExecution` with the local implementation, `LocationServiceMap`, `PermissionSaved`, `Credential`, and the rest of `packages/server/src/routes.ts`'s `applicationServices`) into one `ManagedRuntime`. Handlers are ordinary async functions that call `runtime.runPromise(...)` exactly at the core boundary.

Rules:

- No Effect types in handler signatures, route definitions, or anything `AppType` can see.
- Core failures map to the typed error envelope in §5.6 at the boundary. Defects become a generic 500 with a correlation id in the log, never a serialized cause.
- The runtime is built once and disposed on shutdown. There is no per-request layer construction.

### 3.3 Process model

One process, one SQLite database, WAL mode. The stream registry (§5.2) is an in-memory map; stream resources do not survive a restart, which is correct because `runtime_id` changes on restart and volatile scopes reset anyway. There is no clustering story and no shared state outside the process.

<!-- ponytail: single-process registry; a multi-process design needs stream state externalized, revisit only if hena ever forks workers -->

---

## 4. Data model

### 4.1 Feed and changelog

Core owns the tables exactly as web-ui.md §4.2 defines them, added by core migration:

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

Indexes: `(collection, scope_key, seq)` and `(created_at)`. `feed_id` is random, minted when the table is first created; a database replacement mints a new one. `runtime_id` is random per boot.

The emitter is a core service with a transaction-scoped API. A durable write path calls `changelog.emit(op)` inside the same Drizzle transaction as its domain write; the emitter serializes the DTO (from `packages/schema/sync`), enforces the §4.6 row bound, and inserts. There is no interception magic: each write path is edited to emit, and the per-collection audit test in §10 is what proves none was missed. `reset` follows web-ui.md §4.2 semantics: empty `row_key`, null `row`, applies to the whole `(collection, scope_key)`, and must be followed by replacement data.

Derived and volatile sources (agents, models, providers, locations, permissions, questions) do not write the changelog. They publish a source revision; a change or a runtime restart forces a replacement snapshot for the scope.

Retention: delete `collection_change` rows older than 7 days or beyond 500,000 rows, whichever binds first, in one transaction with the `retained_floor` advance. Initial values, adjusted by measurement. A cursor below the floor gets `snapshot_required` per §5.5.

### 4.2 Row identity

A client storage key is `(connection identity, collection, manifest key)` per web-ui.md §4.1. Manifest keys are frequently composite and are never flattened into a single string on the wire. `scope_key` is the empty string for instance scope, the Session ID for Session scope, and the canonical Location key for Location scope.

### 4.3 v1 collections

v1 synchronizes the core-loop set:

| Collection      | Scope          | Durability | Notes                                                        |
| --------------- | -------------- | ---------- | ------------------------------------------------------------ |
| `projects`      | instance       | durable    |                                                              |
| `locations`     | instance       | derived    | New enumeration; exposes every Location key the server serves |
| `sessions`      | instance       | durable    |                                                              |
| `sessionInputs` | Session        | durable    | Carries the queue revision (§6.2)                            |
| `messages`      | Session        | durable    | Full V2 message union per web-ui.md §4.1                     |
| `parts`         | Session        | durable    | Assistant content only; key includes content kind            |
| `todos`         | Session        | durable    | Requires the durable todo ID migration below                 |
| `permissions`   | server runtime | volatile   | Request ID keyed; reset on runtime change                    |
| `questions`     | server runtime | volatile   | Request ID keyed; reset on runtime change                    |
| `settings`      | instance and Location | derived, revisioned | New collection (§4.4)                          |
| `agents`        | Location       | derived    |                                                              |
| `models`        | Location       | derived    |                                                              |
| `providers`     | Location       | derived    |                                                              |

Phase 2 collections, with manifest entries written now and marked deferred: `serverCommands`, `skills`, `mcpServers` (needs the V2 MCP group in core), `integrations`, `sessionDiffs`, `ptys` (Milestone 2 terminal).

The durable todo ID is a core migration, not a client workaround: todos gain a server-issued stable ID (ULID) that survives reorder and edit. The `(session_id, position)` key is demoted to ordering data. The rollback-compatible `todo.updated` event remains live-only, and all of its registered database projectors commit in one transaction before listeners are notified.

### 4.4 The settings collection

web-ui.md §6.6 allows queueable non-secret replace-style settings but its §4.1 manifest has no settings collection. This document adds one, and §13 amends the manifest.

- Rows project a closed allowlist of non-secret core config keys. Each row: `key`, `value` (bounded JSON), `scope` (instance or Location key), `revision`.
- Secrets (API keys, OAuth material, passwords) are never rows, never changelog entries, never log lines. They move only through the online-only RPC in §6.3.
- One mutation, `settings.replace`, carries the expected revision; a mismatch returns the typed conflict in §5.6 with the authoritative row, and the client keeps the attempt as editable intent.

### 4.5 Receipts and the idempotency ledger

Every queueable mutation carries an operation name, a client-generated idempotency key (UUID), a canonical request fingerprint, and any expected revision. The fingerprint is SHA-256 over the canonical JSON encoding of the operation payload; canonical means sorted keys and no insignificant whitespace, implemented once in `packages/schema/sync`.

The ledger is a core table written in the same transaction as the domain write:

```sql
idempotency_record(
  principal   TEXT NOT NULL,      -- "local" in auth phase 1
  operation   TEXT NOT NULL,
  key         TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response    TEXT NOT NULL,      -- recorded response body, bounded
  txid        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (principal, operation, key)
)
```

Exact replay (same key, same fingerprint) returns the recorded response with `outcome: "exact_retry"`. Same key with a different fingerprint returns `409 idempotency_conflict`. Records are retained 30 days, which must exceed the client outbox's maximum expiry; the client spec owns that number and this one moves with it.

The receipt is web-ui.md §4.3's shape unchanged:

```ts
type TransactionReceipt = {
  txid: string
  outcome: "applied" | "noop" | "exact_retry"
  through: { feedId: string; seq: number }
  affectedScopes: Array<{ collection: string; scopeKey: string }>
}
```

The HTTP response carries it, and the `rows` frame that delivers the transaction carries the same `txid`, which is what TanStack DB's txid awaiting consumes. There is no receipt lookup endpoint; a client that lost the HTTP response replays the mutation and receives the recorded response. That cut is deliberate (§5.7).

A prompt receipt confirms admission, never model execution.

### 4.6 Bounds

The web-ui.md §4.4 table is adopted unchanged: 64 KiB control requests, 500 operations per rows frame, 1 MiB decoded rows frame, 4 MiB per-stream queued output, 32 KiB / 500 line tool-output previews, 2 MiB in-flight part, 256 KiB full-content page, 5 MiB per attachment file and 20 MiB per prompt inlined. Settings rows bound at 16 KiB per row. Bounds are enforced at ingress by middleware and at changelog emit time by the emitter, so an oversized row is a write-path bug caught in the same transaction, not a stream-time surprise.

---

## 5. Protocol

### 5.1 Endpoints

```text
GET    /api/collection/capabilities
POST   /api/collection/streams
PUT    /api/collection/streams/:streamId/subscription
GET    /api/collection/streams/:streamId/events
DELETE /api/collection/streams/:streamId
```

`GET /capabilities` is the handshake and the only endpoint callable before trust: `{ feedId, protocol: { min, max }, auth: "none" | "required" }`, no credential required, `Cache-Control: no-store`, CORS headers on every status including 401. It exposes no data beyond the handshake.

`POST /streams` returns `{ streamId, generation, expiresAt, feed: { feedId, runtimeId, retainedFloor }, subscriptionRevision }`. `streamId` is 128 bits of `crypto.getRandomValues` in base64url. The resource binds to the authenticated principal; in auth phase 1 that principal is `"local"`. There is no separate control token (§5.7 cut 1). Each stream accepts at most 100 Session subscriptions and 1,000 cursors.

The subscription PUT supplies complete desired state, revisioned, exactly as web-ui.md §5.1 defines:

```ts
type SubscriptionState = {
  revision: number
  lists: boolean
  sessions: string[]
  cursors: Record<string, { feedId: string; seq: number }> // key: `${collection}:${scopeKey}`
}
```

Only increasing revisions are accepted. Omitting a cursor requests a replacement snapshot for that scope. A new SSE attachment on `GET /events` increments `generation` and supersedes the old attachment; frames from a superseded generation are ignored by the client. Stream resources expire 5 minutes after their last attachment disconnects.

### 5.2 Snapshot and live handoff

Per newly requested `(collection, scope)`:

1. Register a live-change buffer for the scope.
2. Open one consistent read transaction, capture `baseSeq`.
3. `snapshot.begin` with `scope`, `snapshotId`, `baseSeq`, `replace: true`.
4. Bounded `snapshot.page` frames from that single read transaction.
5. `snapshot.end` with the complete key count and `throughSeq` (always equal to `baseSeq`; a mismatch is a protocol error).
6. Replay buffered operations with `seq > throughSeq`.
7. Live rows.

The snapshot source for durable collections is the domain tables projected through the same DTO projectors the emitter uses, inside one read transaction, so a snapshot can never interleave two write states. Derived and volatile collections snapshot from their in-memory or catalog source tagged with `runtimeId` or source revision.

Rows frames carry whole server transactions in sequence order, batched at the smaller of 50 ms, 500 operations, or 1 MiB, merging only whole transactions and never splitting one. A transaction that cannot fit the bounds is not framed at all: the server emits `reset` for each affected scope followed by a fresh snapshot (§5.7 cut 4). Cursor metadata advances only with the rows it covers.

### 5.3 Frames

Every frame carries `protocolVersion`, `feedId`, `runtimeId`, `streamId`, `generation`, and the accepted subscription revision.

| Frame            | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| `stream.ready`   | Confirms attachment, generation, feed bounds                |
| `snapshot.begin` | Starts a scoped replacement snapshot                        |
| `snapshot.page`  | One bounded page                                            |
| `snapshot.end`   | Completes replacement; key count validation                 |
| `rows`           | Transactional row operations, cursor range, receipt txids   |
| `delta`          | Ordered ephemeral text, reasoning, tool-input, compaction   |
| `heartbeat`      | Liveness every 15 seconds                                   |
| `error`          | Typed recoverable or terminal failure                       |

There is no standalone cursor frame. Deltas bypass rows batching.

### 5.4 Deltas

The frame is web-ui.md §5.4's shape unchanged: `{ sessionId, messageId, partId, partKind, offset, text }`, with `offset` a byte offset into the UTF-8 encoding of the finalized text, chunks aligned to code point boundaries.

The source is core's existing typed events in `packages/schema/src/session-event.ts`: `session.next.text.delta`, `session.next.reasoning.delta`, `session.next.tool.input.delta`, and `session.next.compaction.delta`, consumed through `EventV2`. Core events carry text chunks; the server tracks accumulated encoded byte length per in-flight part and stamps offsets. Per web-ui.md §4.1, a compaction delta targets the compaction message ID with `partKind: "compaction"` and `partId` equal to the message ID.

Deltas are not replayable. A reconnect gets no backfill; the client marks the part incomplete until the finalized row arrives through `rows`, and finalized rows are authoritative by row revision. Old-generation deltas are discarded client-side by the generation stamp.

### 5.5 Reconnect, backpressure, retention

Three missed heartbeats mean dead; the client reconnects with jittered exponential backoff (1 to 60 seconds) and a new generation. The server bounds streams per principal, active Session scopes per stream, control churn, queued bytes (4 MiB), and concurrent snapshot work. A slow durable consumer is disconnected with `slow_consumer` and resumes from its committed cursor; durable rows are never dropped. A cursor with a foreign `feedId` or below `retained_floor` receives `snapshot_required` for the affected scopes.

Typed stream error reasons: `snapshot_required`, `feed_replaced`, `slow_consumer`, `subscription_revision_conflict`, `unsupported_protocol`, `unauthorized`, `malformed_frame`.

### 5.6 Error envelope

Every non-2xx RPC response is `{ error: { code, message, details? } }` with a closed code set: `validation`, `not_found`, `conflict`, `idempotency_conflict`, `revision_conflict`, `already_resolved`, `unauthorized`, `upgrade_required`, `payload_too_large`, `rate_limited`, `internal`. Codes are part of `AppType`, so the client switches on them with type safety. `already_resolved` is a 200-level outcome, not an error: a permission or question reply that lost a race returns 200 with the authoritative resolution so the client reconciles without a destructive error path.

### 5.7 Recorded deviations from web-ui.md

Each of these was decided in the design interview, is normative for v1, and requires the §13 amendment:

1. No separate stream control token. The stream resource binds to the authenticated principal plus a 128-bit random `streamId`; control requests use normal request auth. Returns only if a concrete threat model shows principal binding is insufficient.
2. `snapshot.end` validates by key count only. No content hash.
3. No `GET /api/collection/transactions/:txid`. Idempotent exact-retry replay is the receipt recovery path; the ledger, not a lookup service, survives a lost response.
4. No continuation frames. A transaction exceeding frame bounds becomes scoped `reset` plus fresh snapshot, the escape hatch web-ui.md §4.2 already blesses. Returns only if reset-plus-snapshot proves too disruptive for large reverts in practice.
5. Hono RPC replaces the generated Promise client from `@hena/client` for every V3 HTTP call. web-ui.md §1.4's client-stack sentence changes accordingly.
6. Mutations are resource-style Hono routes (§6.1), not a single mutation envelope endpoint. The idempotency fields ride in the request body of each queueable route.
7. The manifest gains the `settings` collection (§4.4).

---

## 6. Mutation surface

### 6.1 Routes

All mutations are Hono routes under `/api`, validated with Effect Schema, visible in `AppType`. Queueable routes accept the §4.5 idempotency fields and return a `TransactionReceipt`.

| Route                                        | Class            | Notes                                                            |
| -------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `POST /api/session`                          | queueable        | Compound create Session plus admit first prompt; client-generated Session and message IDs; one transaction |
| `POST /api/session/:id/prompt`               | queueable        | Admit prompt; delivery mode `steer` or `queue`; message ID client-generated |
| `POST /api/session/:id/input/:inputId/cancel`| queueable, bounded | Carries expected queue revision                                |
| `PUT  /api/session/:id/input-order`          | queueable, bounded | Complete desired order plus expected queue revision            |
| `PUT  /api/settings/:scope/:key`             | queueable        | `settings.replace` with expected revision (§4.4)                 |
| `POST /api/session/:id/interrupt`            | online-only      | Targets the active drain; idle interruption is a no-op            |
| `POST /api/permission/:id/reply`             | online-only      | Pending nonce; race returns `already_resolved`                   |
| `POST /api/question/:id/reply`               | online-only      | Same semantics as permission reply                               |
| `PUT  /api/credential/:providerId`           | online-only      | Secret write; never changelog, never logs, never receipts beyond success |

Session delete and rename ride the same queueable pattern when core exposes them; they are v1 if already present in core, phase 2 otherwise, and the route table in code is the source of truth.

### 6.2 Queue revision

Cancel and reorder need capability core does not have today, and building it is v1 scope: `sessionInputs` gains a per-Session `queue_revision`, incremented in the same transaction as every admit, promote, cancel, and reorder. The revision rides on every `sessionInputs` DTO. A mutation with a stale revision returns `revision_conflict` with the authoritative queue; the client retains the attempt as editable intent per web-ui.md §6.6. Promotion races (the runner promotes an input the user just reordered) resolve in core's serialized runner, so the revision check and the promotion are never concurrent.

### 6.3 Secrets

Provider credentials, OAuth material, and passwords use online-only routes, are validated and passed to core's `Credential` service, and appear in no changelog row, no idempotency record, no log line, and no error detail. The §10 test suite includes a canary: a secret written through the API must not appear anywhere in the database except core's credential store, nor in captured log output.

---

## 7. Read surface

Request-backed reads outside collection sync, all `Cache-Control: no-store`:

| Route                          | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `GET /api/content/:contentId`  | Full-content pages for truncated tool and shell output; revisioned, 256 KiB pages, authorized against the owning Session on every request; the URL is not a bearer capability |
| `GET /api/fs/list`             | Bounded directory listing for composer mentions                       |
| `GET /api/fs/find`             | Bounded fuzzy path search for composer mentions; debounce-friendly    |

References, symbols, and review file reads are phase 2, arriving with `sessionDiffs`.

---

## 8. Origins, serving, and development

### 8.1 Embedded origin

v1 serves the built UI. `GET` paths outside `/api` serve `packages/app-v3/dist` with the web-ui.md §10.1 header classes: `public, max-age=31536000, immutable` for hashed assets under `assets/`, `no-cache` for `index.html`, the service worker, and the manifest. Unknown non-API paths serve `index.html` (single-page fallback). When the dist directory is absent, the server returns a plain-text instruction to run the app build; it never proxies an upstream. `UI_UPSTREAM` and the proxy branch do not exist in this server.

Compression covers static and API responses including raw bodies, and excludes SSE.

### 8.2 CORS

Exact-origin allowlist: `https://app.hena.dev` built in, plus origins added by config. Bounded method and header preflights, `Vary: Origin`, and CORS headers on every status. Cookies are never used; auth is header-only, so there is no `credentials: include` surface.

### 8.3 Development

app-v3's Vite dev server proxies `/api` to server-v3, so development is same-origin and mirrors embedded-origin semantics: no CORS in the daily loop, loopback rules as in production. The server-v3 dev entry (`bun run dev`) listens on a fixed default port of 4106, chosen to avoid colliding with a running V2 `hena serve` on 4096 during the transition. `--port` overrides it. If the port is taken, the server fails with a message naming the conflict and the flag. There is no silent fallback, in dev or anywhere else.

### 8.4 Configuration

| Knob                | Default            | Source                         |
| ------------------- | ------------------ | ------------------------------ |
| Port                | 4106 dev, 4096 at cutover | Flag `--port`            |
| CORS extra origins  | none               | Config `server.cors`           |
| Password            | none (phase 2)     | Existing core config           |
| Changelog retention | 7 days / 500k rows | Config, marked measured-adjustable |

Logging is minimal structured lines to stderr: method, path, status, duration, correlation id. No telemetry, no analytics, matching web-ui.md §11.3's stance.

---

## 9. Authentication

### 9.1 Phase 1: none

v1 implements only the zero-password path. Capabilities report `auth: "none"`, every principal is `"local"`, and no credential endpoints exist. A server configured with a password refuses to start server-v3 routes with a clear message naming phase 2, rather than serving an unauthenticated protocol on a server the operator believes is protected.

### 9.2 Phase 2: device tokens

The full web-ui.md §10.3 model, specified now, built in phase 2:

- Password is exchanged once for a named, revocable device token; the password is never persisted client-side and never re-sent.
- Endpoints: token issue (password exchange), list, revoke. Short-lived access tokens derived from the device token live in client memory only.
- Bootstrap: with a password configured, `hena serve` prints a URL with a single-use code in the fragment; the client exchanges it immediately. Codes live in a server-side ledger with short expiry; replay is refused.
- `?auth_token=` does not exist in this server at any phase.
- Capabilities flip to `auth: "required"`; unauthenticated requests get 401 with CORS headers intact.

Tables (`device_token`, `bootstrap_code`) are specified with the phase 2 change, in core migrations, alongside the principal column becoming meaningful in the idempotency ledger.

---

## 10. Testing

`bun test` from `packages/server-v3`, real core services with temp-dir fixtures, no mocks. The suite is the approval gate for this document:

- Protocol conformance: table-driven tests over a real server instance covering the snapshot/live handoff state machine, buffered replay after `snapshot.end`, cursor resume across reconnect, `reset` semantics including the oversized-transaction path, generation supersession, subscription revision conflicts, and every §4.6 bound rejection.
- Changelog audit: one test per v1 durable collection proving the domain write and its changelog rows commit atomically, by failing the transaction after the domain write and asserting neither is visible.
- Ledger crash points: committed-but-unresponded followed by replay returns the recorded response with `exact_retry`; same key with a different fingerprint returns `idempotency_conflict`; expired records behave as new operations.
- Delta ordering: offsets are contiguous encoded-byte offsets across multibyte content; compaction deltas target the message identity; no delta precedes its durable start row.
- Queue revision: stale cancel and reorder return `revision_conflict` with the authoritative queue; the promotion race resolves serially.
- Secret canary: a credential written through the API appears nowhere in the database outside the credential store and nowhere in captured logs.
- Static serving and headers: header classes per path class, missing-dist instruction page, SPA fallback, compression on raw bodies, SSE excluded.

Literal process-kill harnesses and property-based frame generation are not in v1; the client-plus-server Milestone 0 evidence runs may add them later, and this suite is designed so they bolt on rather than restructure.

---

## 11. Phasing and cutover

### 11.1 Phase 1 (v1)

Everything in §2's v1 rows: the sync protocol with the §5.7 cuts, the core-loop collections including the todo ID migration and `settings`, the full §6 mutation surface including queue revisions, content and fs reads, embedded serving, Vite-proxy development, `auth: "none"`, and the §10 suite.

### 11.2 Phase 2

In dependency order, each item shippable independently:

1. Device tokens and bootstrap codes (§9.2); unblocks client credential persistence.
2. Remaining Location catalogs: `serverCommands`, `skills`, `integrations`, and the V2 MCP group behind `mcpServers`.
3. `sessionDiffs` plus review reads (file content, references, symbols) and revert stage/commit/clear as online-only mutations with current-revision checks.
4. `ptys` and PTY ticket transport, with Milestone 2's terminal.

### 11.3 Cutover

One change in `packages/hena`, gated on the §10 suite and the client's own gates:

- `hena serve` wires server-v3's route tree instead of `packages/server`'s.
- The default-port silent fallback is removed per web-ui.md §3.4; a taken port is a named failure.
- `?auth_token=` handling and the UI proxy fallback (`serveUIEffect`'s upstream branch, `UI_UPSTREAM`) are deleted.
- `createEmbeddedWebUIBundle` builds `packages/app-v3`.

`packages/server` is deleted in the same change. `packages/protocol` and `packages/client` lose their server-v3-facing purpose and follow the dependent-package disposition process web-ui.md §3.2 established; their deletion is a separate change once no consumer imports them.

Rollback is redeploying the previous `hena` artifact whole, per web-ui.md §3.2. Server-v3 adds one obligation: its core migrations (changelog, ledger, todo IDs, queue revisions) are additive, so a rolled-back binary ignores the new tables and columns rather than failing to open the database.

---

## 12. Accepted tradeoffs

| Decision                              | Cost and mitigation                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Old protocol dies with no successor for TUI/SDK | TUI, generated SDK, plugins, and the share viewer must adopt the new protocol or retire; accepted explicitly, no shim is built |
| Core write paths edited for changelog | Invasive core change; the per-collection audit test is the safety net, and cursors become genuinely trustworthy in exchange |
| Effect Schema on the client wire      | Validation runtime rides the deferred sync chunk; bundle cost measured before cutover, with narrow guards as the fallback if it blows the budget |
| No control token, no snapshot hash, no receipt lookup, no continuation frames | Each has a named return condition in §5.7; correctness rests on principal binding, key counts, idempotent replay, and reset-plus-snapshot |
| Full §6.6 allowlist in v1             | Queue revisions are new core work on the critical path; in exchange the client outbox story is complete on day one |
| Password-configured servers refuse phase 1 | A protected server cannot run server-v3 until phase 2; honest refusal beats silent exposure |
| Single process, in-memory streams     | No horizontal scale; matches core's process-local Session coordination, revisited only if that changes |
| Port 4106 in dev                      | One more number to know; avoids colliding with the V2 server during the transition            |

---

## 13. Required amendments to web-ui.md

These land as one documentation change (with its Korean translation) when this document is approved:

1. §1.4: replace the generated Promise client sentence; V3 HTTP calls use Hono RPC types from `@hena/server-v3/protocol`, and protocol changes surface as type errors through `AppType` rather than `bun run generate`.
2. §4.1: add the `settings` collection to the manifest; mark the phase 2 collections' server dependency on this document's §11.2.
3. §5.1: remove the control token from the stream resource; note principal binding.
4. §5.2: replace the continuation-frame rule with reset-plus-snapshot for oversized transactions; key-count-only validation on `snapshot.end`.
5. §4.3 / §5.1: remove `GET /api/collection/transactions/:txid`; exact-retry replay is the receipt recovery path.
6. §12.1: point the server-side Milestone 0 items at this document.

---

## 14. Open items

1. Measure `@hena/server-v3/protocol`'s client bundle cost in the deferred sync chunk; if Effect Schema's footprint threatens the shell budget, the fallback is narrow structural guards for frames only, decided with numbers.
2. Record the queue-revision design's interaction with core's serialized runner once implemented; the promotion-race guarantee in §6.2 must be proven by a test, not asserted.
3. Choose changelog retention numbers from measured update volume after v1 runs against real sessions (web-ui.md §14 item 3).
4. Decide Session delete/rename mutation availability in v1 from what core exposes when implementation starts.
5. Phase 2 auth: device-token lifetime, refresh, and revocation semantics (web-ui.md §14 item 11) are specified with that change.
