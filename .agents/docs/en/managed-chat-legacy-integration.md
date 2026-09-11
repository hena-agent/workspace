# Managed chat legacy integration

## Scope and provenance

Inspected `managed-chat-ui` at HEAD `3e67bb928`, against both HEAD and `develop`.
At the start of this work, the tracked dirty diff contained 86 files, with 5,802
insertions and 424 deletions. The committed branch diff contained 80 files.

Project-first creation, named managed projects, attachment, chat policy, and the
App's initial canonical submission branch were already committed. The additional
canonical history/event adapters, provider catalog work, credential/config changes,
and Core execution changes were already dirty. The parent review confirmed that
the canonical adapter/config changes were assistant-authored; the icon, home, and
i18n changes belong to the user. No blanket restoration or deletion was attempted.

The preexisting project-mode-icon deletion, home/sidebar/i18n edits, console/web
directories, Playwright artifacts, and other untracked fixtures were left alone.
Canonical Core execution and its public API remain intact.

## Plan followed

1. Compare the branch and dirty work, trace Project and Session storage, and record
   the available performance-unit baseline before changing session code.
2. Add chat-safe behavior to the existing Hena execution path before opening its
   HTTP prompt/revert endpoints to new managed chats.
3. Route newly created App chats through that path, retaining the canonical read
   path for already persisted canonical transcripts.
4. Exercise the HTTP lifecycle using isolated databases and a local fake provider,
   then test App submission, history selection, reducers, and package types.
5. Address the parent review's runtime-list and pending-inbox findings, and route
   existing canonical questions and Stop actions through their owning APIs.

## Root causes and changes

- Legacy and canonical execution share Project and Session identity, but use
  different transcript tables. Legacy uses `message` and `part`; canonical uses
  `session_message` and `session_input`. Selecting execution solely from Project
  mode sent App prompts to canonical execution while Stop still addressed Hena.
- New managed chats now use legacy session creation and `promptAsync`. Creation
  records `metadata.appRuntime = "legacy"`. The App uses that hint for model
  catalog, submission, history, and revert selection. Chat drafts no longer select
  worktrees, execute slash commands, or send local-file context.
- Legacy chat tool resolution selects the four real built-ins: `question`,
  `todowrite`, `webfetch`, and `websearch`. It does not load custom replacements or
  append MCP tools. Workspace instructions, skills, references, plan reminders,
  and workspace-oriented system/message/tool plugin hooks are excluded. Tool
  overflow stays inline without a saved-file path. Provider/auth transport remains
  the existing Hena implementation.
- Prompt admission rejects local-file, agent, subtask, and structured-output inputs
  in chat mode. Commands, shell, initialization, and explicit workspace summary
  endpoints retain their workspace guards. HTTP admission also checks canonical
  transcript/inbox rows rather than trusting an editable metadata hint.
- Managed-path discovery failed across macOS `/var` and `/private/var` aliases.
  Managed paths now resolve consistently. Opening a managed Project through Hena
  no longer registers its internal directory as an attached workspace.
- Chat root sessions use an absent relative path rather than an empty one, matching
  attachment's persisted move representation. Attachment now cancels registered
  legacy runs before moving files. Registration is process-local and is removed
  when the run ends; Core does not import Hena.
- One SQL expression identifies canonical ownership from `session_message` or
  `session_input`, including admit-only sessions without a visible transcript.
  Get, project/global lists, child lists, and compatibility event projection use
  that expression. `fromRow` requires the computed column. Canonical ownership
  overrides an incorrect persisted metadata hint. Existing untagged workspace
  metadata retains its prior shape. Reads do not modify stored transcripts.
- The App preserves an established canonical hint through incomplete or stale
  updates. A cold list entry without an authoritative hint is resolved through
  Session.get before selecting history. Canonical admission events establish the
  hint without adding another transcript projector.
- `session-runtime.ts` routes Stop to legacy abort or canonical interrupt. Pending
  question hydration reads both APIs, retaining request ownership. The existing
  question reducers also accept canonical lifecycle events, and the existing dock
  routes replies and rejections through the same helper. Canonical interruption
  now publishes the question rejection event needed to clear the dock.
- Removed the assistant-added directory-level canonical transcript projector.
  Its only production caller disables session content, so it duplicated the active
  server-session projection without serving a runtime consumer. Existing canonical
  transcripts still use the server-session adapter.
- The retained canonical loader now reads the preceding user before mapping an
  assistant window. It follows server sequence cursors, not timestamps or lexical
  IDs. Control records cannot become assistant parents. Short terminal pages from
  older servers stop loading even if they advertise another cursor. The current
  message endpoint uses one-record lookahead to terminate exact full-page
  boundaries without an empty follow-up request, in either paging direction.
- Canonical part display order now comes from stored content and live event order.
  A separate reactive order index feeds the timeline through `session.parts`;
  `data.part` remains ID-sorted for existing binary-search mutation paths. Refresh,
  removal, and eviction maintain that index. Pending tool parts use the name from
  `tool.input.started`, so a question no longer appears as an unnamed tool.
- No new restrictions on caller-supplied system text were added. An HTTP regression
  test verifies explicit system text is preserved while the chat tool allowlist
  and automatic workspace-context exclusion remain in effect.

## Verification

All commands ran from their package directories. Providers were local test
servers, not live services. Test databases and filesystem fixtures were isolated.

| Package | Checks | Result |
| --- | --- | --- |
| Hena | `test/server/httpapi-session.test.ts` | 26 passed; the prior 25-test version also passed three successive separate-process runs |
| Hena | Session, global/project lists, HTTP event tests | 24 passed |
| Hena | `test/tool/registry.test.ts` | 16 passed |
| Hena | `test/session/llm.test.ts`, `test/session/llm-native.test.ts` | 43 passed |
| App | original targeted compatibility/timeline run | 152 passed, but did not cover submit-first module loading; see isolation verification below |
| Core | Project, ProjectAttach, ProjectDirectories tests | 21 passed |
| Core | Question and question-tool tests | 7 passed |
| Core | Session runner question/interruption cases | 13 passed |
| App, Hena, Core, Server | `bun typecheck` | Passed |

The added HTTP lifecycle test verifies named Project creation without a Session,
first and second prompts, exact tool names and absence of internal system paths,
question publication and a running tool part, answer/resume, interruption,
revert/unrevert, edit replacement, history refresh, attachment during execution,
stable Project/Session/message IDs, and subsequent workspace tools/context.
It also keeps a saved canonical transcript readable after attachment and checks
that the read hint does not mutate stored metadata. The attached project's actual
session list is checked, not only Session.get. An inbox-only child is tested through
get, both lists, children, and an incomplete compatibility update event.

Another HTTP test imports the actual App runtime helpers and uses the generated SDK
against the isolated server. An existing canonical chat asks a question, accepts an
answer and continues, asks another question and is rejected, then asks a third and
is stopped. The test checks that pending requests disappear and settlement events
are published. Rejection intentionally interrupts continuation, matching the Core
runner's existing contract.

App tests verify first-prompt-only creation, a second legacy submission without a
canonical model catalog, both Stop routes, request-owned reply/reject routes,
runtime/history selection, and both question event vocabularies. A cold incomplete
list and later stale metadata updates cannot erase canonical history ownership.
These are not browser rendering tests.

The retained-history follow-up reproduced missing canonical parents and unnamed
pending tools before the fix. Its tests cover multi-page ancestry with timestamp
ties and control records, sequence-based retention of previously loaded history,
true terminal pages without fabricated cached parents,
the API page-size cap, persisted reasoning/text/question order, order-only refreshes,
and live parts arriving during a stale snapshot load. HTTP cursor tests invert
insertion/ID order, tie timestamps, and traverse exact page boundaries forward and
backward. The new legacy execution path was not changed.

The original performance-unit baseline was 43 passing tests in 601 ms; that pass
ended at 550 ms. The review follow-up baseline was 565 ms and the final run was
344 ms for the same 43 passing tests.
These are test-run durations, not evidence of an App performance improvement.
The retained-history paging/order follow-up passed the same 43 checks before and
after its edits, at 337 ms and 370 ms respectively.

One concurrent validation run hit the canonical question test's five-second poll
timeout. Three subsequent full HTTP runs passed in separate processes. The
integration poll now allows ten seconds. Bun's same-process `--rerun-each` is not
usable with this suite's teardown: it removes the shared temporary log directory
and disposes the runtime after the first run. That unrelated fixture behavior was
not changed.

### Submit-test isolation

The parent's exact submit-first command reproduced 29 passes, 2 failures, and
1 error. Bun's process-wide `mock.module` registrations in the submit suite replaced
the encode module with an object lacking `base64Decode`, and replaced the real
generated SDK factory with a fake client lacking question methods. Other file
orders had concealed this test-isolation bug.

The mock-heavy suite now lives unchanged in `submit.fixture.ts`, beside the code it
tests. `submit.test.ts` invokes it in a Bun subprocess with the same Happy DOM
preload and reports the child's failures. The fixture is still typechecked but is
not picked up by normal test-file discovery. No mock exports were expanded, and no
production or real-SDK test code changed for this fix.

Verification from `packages/app`:

- Exact command: `bun test --only-failures --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts ./src/context/server-session.test.ts ./src/context/session-runtime.test.ts ./src/context/global-sync/event-reducer.test.ts`.
  Result: 122 passed, 0 failed, 0 errors. The parent count includes one wrapper test.
- Direct fixture execution: 10 passed, 31 assertions.
- `bun run test:unit`: 657 passed and 1 known i18n parity failure. Its first failing
  locale, `ar`, lacks the five existing keys `dialog.provider.custom.label`,
  `dialog.model.unpaid.viewMoreProviders`, `session.header.reveal.finder`,
  `session.header.reveal.fileExplorer`, and `session.header.reveal.containingFolder`.
  There were no SDK import or mock-poisoning errors.
- `bun typecheck` and `git diff --check`: passed.

## Remaining work and limits

- Existing canonical transcripts are not migrated to legacy execution. Their
  canonical execution branch remains operational through the routed App actions.
  No live transcript migration is needed for the tested flows.
- If stored history genuinely lacks a preceding user, the loader stops at the
  true end without inventing a cached parent or modifying the transcript.
- Canonical catalog/credential code still used by those sessions or the independent
  API remains. Only the unused duplicate directory transcript projector was removed.
- Actual browser rendering of questions and production performance were not
  verified. `agent-browser` is unavailable. Read-only CDP discovery at
  `127.0.0.1:9222/json/list` returned connection refused. Process/listener inspection
  found no alternative Electron debug endpoint; the accessible automation browser
  had only `about:blank`. No page was navigated or reloaded. The production benchmark
  config builds and launches an App server, and was not run. No existing App or
  server was restarted, and no live transcript was edited.
- The parent supplied independent review findings, which drove the follow-up fixes
  and regression tests documented here.
- No commits or pushes were made.
