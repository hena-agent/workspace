# Managed chat Projects

Specification for managed chat Projects and their one-way promotion into user-owned workspaces.

Status: approved design, reconstructed from PR #55 and confirmed in the design interview on 2026-08-30.

Related implementation: `packages/schema`, `packages/core`, `packages/protocol`, `packages/server`, `packages/client`, `packages/sdk/js`, and the embedded server in `packages/hena`.

---

## 1. Purpose

Hena must support a chat Session before the user selects or creates a checkout directory. The Session still needs a stable Project identity and a real filesystem location for runtime invariants, retained outputs, and later promotion into a workspace.

A managed chat Project provides that backing without exposing it as a user workspace:

- The user starts a chat without selecting a directory.
- Hena creates a private Project directory under its global data root.
- The chat uses a restricted, non-filesystem tool set.
- The user may later attach the Project to a new or empty directory.
- Attach preserves the Project and Session identities and moves their durable filesystem ownership to the selected directory.
- Attach remains recoverable across process failure without a database operation journal.

"Folderless" means that the user has not selected a checkout. It does not mean that the Project has no physical directory.

## 2. Scope and non-goals

### 2.1 In scope

- `chat` and `workspace` Project modes.
- Private managed directory provisioning for chat Sessions.
- Restricted chat-mode tools.
- One-way Project attach.
- Session location migration during attach.
- Crash-safe filesystem recovery.
- Migration of existing Project rows to `workspace` mode.
- Foreign-key-safe, serialized database migration startup required to deploy the new schema.

### 2.2 Non-goals

- A nullable or absent Project worktree.
- Lazy materialization of a Project directory.
- Project fork or detach APIs.
- Merging managed files into a non-empty directory.
- Keeping both the managed Project and an attached copy.
- Remote or clustered Session execution ownership.
- A public attach-operation table, status endpoint, or manual recovery endpoint.
- UI implementation. Clients may consume the protocol and generated SDK changes separately.

## 3. Domain model

### 3.1 Project invariants

Every Project has:

- A stable `Project.ID`.
- A non-null `worktree` that names a real absolute directory.
- A mode of `chat` or `workspace`.

The modes mean:

| Mode | Directory owner | User checkout | Filesystem coding tools |
| --- | --- | --- | --- |
| `chat` | Hena | No | No |
| `workspace` | User | Yes | Governed by the normal agent and permission policy |

The mode, not directory nullability or path shape, is the authoritative semantic distinction.

### 3.2 Managed identity and storage

New managed Project IDs use the `prj_` prefix. Their directories live under:

```text
<global-data>/projects/<projectID>
```

Hena creates each directory recursively with mode `0700` on platforms that support Unix permissions. Project resolution recognizes a managed ID only when the path is under the managed projects root and the first relative path segment is a valid managed Project ID.

Each newly created chat Session receives its own managed Project and filesystem space. Chat Sessions do not implicitly share a managed Project.

Existing workspace Session creation remains unchanged. Omitting `mode` means `workspace`, and workspace creation resolves its Project from the supplied Location.

### 3.3 Session identity

A chat Session records the managed directory as its Location and the managed Project ID as its Project. Attach preserves:

- Project ID.
- Session ID.
- Message and event history.
- Relative Session subpath.
- Session ancestry and other existing metadata.

Attach changes only ownership mode and Location. It does not create a replacement Project or Session.

### 3.4 Chat-mode tools

The model-visible allowlist for `chat` Projects is exactly:

- `question`
- `todowrite`
- `webfetch`
- `websearch`

Filesystem reads, writes, edits, search, shell execution, and other workspace tools are not advertised in chat mode. Normal tool resolution resumes after the Project becomes a workspace.

The runner derives this decision from the current Project mode on each provider turn. It must not cache the pre-attach tool set across the mode transition.

## 4. Public protocol

### 4.1 Create a chat Session

`POST /api/session` accepts:

```ts
{
  id?: Session.ID
  agent?: Agent.ID
  model?: Model.Ref
  mode?: "chat" | "workspace"
  location?: Location.Ref
}
```

Rules:

- `mode: "chat"` must not include `location`.
- A chat request provisions the managed Project before the Session creation event is committed.
- If Session projection fails and no Session was recorded, Hena removes the newly created Project row and managed directory.
- Workspace requests require or derive a normal Location under the existing behavior.

### 4.2 Attach a Project

```text
POST /api/project/:projectID/attach
```

Payload:

```ts
{
  directory: AbsolutePath
}
```

Success returns `204 No Content`.

Attach is Project-scoped even though each new chat Session currently has its own managed Project. Every Session found under the Project is moved together so recovery remains correct if Project membership expands through existing compatibility paths.

### 4.3 Attach validation

The server must reject attach when:

- The Project does not exist: `404 ProjectNotFoundError`.
- The Project is neither a chat Project nor an exact completed retry: `409 ConflictError`.
- The target is inside the managed source directory: `400 InvalidRequestError`.
- The target exists and is not a directory: `400 InvalidRequestError`.
- The target directory is not empty: `409 ConflictError`.
- The Project has incompatible directory ownership records: attach fails without changing ownership.
- Filesystem movement or recovery cannot establish an unambiguous safe state: `500 UnknownError` and fail closed.

The target may be absent or an existing empty directory. The server canonicalizes existing paths, rejects symlink aliases that do not match the requested existing path, and locks canonical paths rather than unchecked input strings.

### 4.4 Exact retry

Attach is idempotent for the completed tuple `(projectID, canonical target)`:

- If the Project is already `workspace` mode and its worktree equals the same canonical target, return `204`.
- If it is already attached to another target, return `409`.
- A pending filesystem manifest is recovered before this decision.

No public idempotency key or attach operation ID is required.

## 5. Attach transaction model

SQLite and directory rename cannot participate in one atomic transaction. Attach therefore uses a filesystem manifest, ownership markers, guarded Session events, and one database commit point.

### 5.1 Manifest

The manifest path is:

```text
<global-data>/projects/.hena-attach-<projectID>.json
```

It records:

- Format version.
- Random operation ID.
- Project ID.
- Canonical source and target.
- Whether the target existed before attach.
- Every affected Session ID, original directory, relative subpath, and workspace ID.

The server writes a temporary file and renames it over the final path. It never exposes an incomplete manifest. The manifest is internal recovery state, not a public API resource.

### 5.2 Locking

Attach acquires:

1. A process-local keyed mutex for the Project.
2. A cross-process Project lock.
3. Cross-process locks for the canonical source and target paths, acquired in sorted order.

The path locks serialize attempts to claim the same target. A partial unique index on attached Project directories enforces exclusive ownership in SQLite. Sorted lock acquisition prevents lock-order deadlocks. A compromised or timed-out lock is a defect, not permission to continue without ownership.

### 5.3 Execution boundary

Before moving files, attach blocks the Project and interrupts every affected Session. Provider streams and tools must not continue across the directory ownership change.

Project blocking is visible both through process memory and the on-disk manifest. Other Projects may continue running.

The coordinator registers its owner before drain eligibility checks. Attach establishes the block before interrupting those owners, so a drain that observed an unblocked Project cannot start after the attach-side interruption.

After attach commits or rolls back, Hena removes the block and wakes affected Sessions. Interruption does not replay unfinished provider work; existing durable Session execution rules decide what remains eligible.

### 5.4 Forward path

Under the locks, attach performs these steps:

1. Recover any earlier manifest for the Project.
2. Validate Project mode, source ownership, exclusive target ownership, Project directories, and Session snapshot.
3. Create the target parent if needed.
4. Block the Project and atomically persist the manifest.
5. Interrupt affected Sessions.
6. Write the operation ownership marker into the source.
7. Copy the source into a sibling staging directory.
8. Rename the source to an operation-specific backup.
9. Revalidate that an existing target is still an empty directory, then remove that empty directory.
10. Rename staging to the target.
11. Publish guarded, deterministic `SessionEvent.Moved` events that preserve each Session subpath.
12. In one SQLite transaction, revalidate the Project and complete Session snapshot, set the Project to `workspace`, set its worktree to the target, and insert the attached Project directory record.
13. Remove the owned source backup, staging residue, target marker, and manifest.
14. Unblock the Project and wake its Sessions.

The database update in step 12 is the commit point.

### 5.5 Event consistency

Each forward and rollback Session move uses a deterministic event ID derived from the operation, Session, and direction. Recovery checks whether each event already exists before publishing it.

Event guards verify that the current Session still belongs to the Project and matches the expected source or target state. A concurrent Session ownership change aborts the operation rather than overwriting newer state.

## 6. Failure and crash recovery

### 6.1 Runtime failure before commit

If any forward step fails before the database commit point, rollback must:

1. Publish rollback move events for Sessions that received forward events.
2. Restore the owned backup to the original source.
3. Remove owned staging residue.
4. Rename an owned target to:

```text
<target>.hena-recovered-<operationID>
```

5. Recreate the original empty target only if it existed before attach.
6. Remove the source marker and manifest.
7. Unblock and wake the affected Sessions.

Rollback never recursively deletes an owned target. A user or another process may have written files after target promotion and before failure. Quarantine preserves those files even when the target otherwise contains only Hena's copied data.

### 6.2 Startup recovery

On startup, Hena scans the managed projects root for attach manifests. For each manifest it acquires the normal Project and path locks, blocks the Project, and chooses the result from durable Project state:

- If the database says `workspace` and the Project worktree is the manifest target, finish committed cleanup.
- Otherwise, roll back to the source.

Filesystem placement alone never decides commit. The Project row is authoritative.

### 6.3 Fail-closed ownership

Recovery mutates or deletes only directories carrying the expected operation marker. It stops and leaves evidence in place when:

- Source, backup, staging, or target ownership is ambiguous.
- The Project or Session snapshot changed unexpectedly.
- A recovered quarantine path already exists.
- The manifest is malformed.
- The durable Project state names neither the expected source nor committed target.

An unresolved manifest continues to block Session execution for that Project. Recovery logs the cause; it does not guess, overwrite, or silently discard the manifest.

## 7. Prompt behavior during attach

Only new prompt admission changes at the public Session API boundary:

- If the Project is blocked in process memory or has an attach manifest on disk, a new prompt returns the existing `ConflictError` with HTTP `409`.
- The prompt is not inserted into `session_input`.
- The client must retry after attach or recovery completes.

Other execution-starting controls retain their existing behavior. Read-only Session and history requests remain available, and interrupt remains allowed.

This rule deliberately overrides the usual separation between durable prompt admission and model execution for the short attach window. It prevents a client from receiving a successful admission receipt for work whose Location is changing.

## 8. Database migration requirements

### 8.1 Project mode migration

The `project` table gains:

```sql
mode TEXT NOT NULL DEFAULT 'workspace'
```

Every existing Project becomes `workspace`. The migration does not infer chat mode from path shape and does not rewrite Project or Session identities.

### 8.2 Migration startup safety

Database initialization must:

- Serialize concurrent migration attempts in one process and recheck each migration journal entry under a SQLite write lock so separate processes cannot apply the same migration twice.
- Use SQLite transactions for each migration and its migration-journal insert.
- Disable foreign-key enforcement outside a transaction only for a pending migration phase that may rebuild referenced tables.
- Restore and verify foreign-key enforcement after both successful and failed migration application.
- Preserve the original migration failure rather than masking it with cleanup failure.
- Reject a non-empty unknown database that lacks the expected `session` table.

SQLite ignores `PRAGMA foreign_keys` changes made inside a transaction. The runner owns this policy; migrations must not rely on in-transaction toggles or depend on cascades while enforcement is disabled.

### 8.3 Journal compatibility

Existing installations may contain Drizzle's `__drizzle_migrations` journal. When the new TypeScript migration journal is empty, startup seeds it once from the legacy journal before applying pending migrations. Old SQL migrations must not replay.

Fresh databases install the generated schema and mark every tracked migration complete in the same initialization transaction.

## 9. API and package boundaries

- Browser-safe `Project.Mode`, Project payloads, IDs, and endpoint schemas belong to `packages/schema` and `packages/protocol`.
- Filesystem manifests, locks, recovery, Project blocking, and Session movement belong to `packages/core`.
- HTTP error mapping belongs to `packages/server`.
- Embedded Hena and standalone server startup both run attach recovery before normal execution.
- Public Protocol or Server `HttpApi` changes require `bun run generate` from `packages/client`.
- Legacy JavaScript SDK changes require `./packages/sdk/js/script/build.ts`.
- Generated Client and SDK files are outputs and must not be edited directly.

Runtime dependencies remain directed from Schema to Core and Protocol, then to Server. Client runtime code must not depend on Core or Server.

## 10. Observability and operator behavior

- Expected validation failures return typed HTTP errors and do not create a manifest.
- Attach rollback failure logs the original cause and recovery cause.
- Startup recovery failures log the manifest entry and cause.
- Successful recovery removes the manifest.
- Quarantined targets are intentionally retained for manual inspection. This specification does not define automatic retention or deletion.
- There is no public operation-status endpoint. The Project mode and worktree describe completed state; a remaining manifest describes internal incomplete state.

## 11. Acceptance criteria

### 11.1 Managed chat creation

- Creating a chat Session without a Location creates one `0700` managed Project directory and a `chat` Project row.
- Providing a Location with `mode: chat` returns `400`.
- Projection failure removes an otherwise unreferenced managed Project and directory.
- Separate chat Session creation requests receive separate Project IDs and directories.
- Chat provider turns advertise only the four allowed tools.

### 11.2 Attach success and validation

- Attach to an absent target succeeds and preserves file contents, Project ID, Session IDs, and relative Session paths.
- Attach to an existing empty directory succeeds.
- Attach to a non-empty directory returns `409` without modification.
- Attach inside the managed source returns `400`.
- Attach of a workspace Project to a different target returns `409`.
- An exact completed retry to the same canonical target returns `204`.
- The Project becomes `workspace`, the target becomes its worktree, and its directory strategy records `attach`.

### 11.3 Failure and recovery

- A failure after one or more forward Session moves restores every Session through guarded rollback events.
- Runtime rollback restores the source and quarantines the owned target.
- A file written into the target during the failed operation survives in quarantine.
- Startup recovery rolls back when the Project remains `chat`.
- Startup recovery completes cleanup when the database has committed `workspace + target`.
- Ambiguous or malformed recovery state leaves the manifest and user data in place.
- Same-Project and same-target concurrent attach requests cannot execute their filesystem critical sections concurrently, including across processes sharing the data root.
- Replacing an owned staging directory before rollback causes fail-closed recovery rather than recursive deletion.

### 11.4 Execution blocking

- A blocked Project cannot start a Session drain.
- A drain that passed its first eligibility check cannot cross the attach block transition and begin afterward.
- A manifest blocks execution even after process memory is lost.
- New prompt admission returns `409` while either block signal exists and writes no `session_input` row.
- Other Projects continue executing.
- Successful commit or rollback unblocks and wakes affected Sessions.

### 11.5 Migration and protocol gates

- Existing Project rows backfill to `workspace` without metadata loss.
- Concurrent embedded initialization applies each migration once.
- Concurrent processes recheck migration completion under the database write lock.
- Foreign-key enforcement is restored after successful and failed migration attempts.
- Client and legacy SDK generation produce committed outputs.
- The HttpApi exerciser contains a scenario for `POST /api/project/{projectID}/attach` with no missing route.
- Core attach tests cover success, validation, runtime rollback, user-file quarantine, and startup recovery.
