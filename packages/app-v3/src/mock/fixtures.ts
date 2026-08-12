import type {
  Agent,
  Connection,
  DiffFile,
  DiffLine,
  FileNode,
  McpServer,
  Model,
  PermissionRequest,
  Project,
  Provider,
  QuestionRequest,
  ServerCommand,
  Session,
  SessionMessage,
  Todo,
} from "@/lib/types"

// Deterministic timestamps (ms) relative to a fixed "now" so grouping/relative
// time in the UI is stable across test runs and screenshots.
export const MOCK_NOW = new Date("2026-08-10T18:00:00.000Z").getTime()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const connections: Connection[] = [
  { id: "conn-local", name: "Local", url: "http://localhost:4096", status: "online" },
  { id: "conn-staging", name: "staging.hena.dev", url: "https://staging.hena.dev", status: "connecting" },
]

export const projects: Project[] = [
  {
    id: "proj-hena",
    connectionId: "conn-local",
    name: "hena",
    path: "~/code/hena",
    color: "purple",
    updatedAt: MOCK_NOW - 5 * MIN,
  },
  {
    id: "proj-marketing",
    connectionId: "conn-local",
    name: "marketing-site",
    path: "~/code/marketing-site",
    color: "cyan",
    updatedAt: MOCK_NOW - 3 * HOUR,
  },
  {
    id: "proj-infra",
    connectionId: "conn-local",
    name: "infra",
    path: "~/code/infra",
    color: "orange",
    updatedAt: MOCK_NOW - 2 * DAY,
  },
  {
    id: "proj-docs",
    connectionId: "conn-staging",
    name: "docs",
    path: "~/code/docs",
    color: "mint",
    updatedAt: MOCK_NOW - 6 * HOUR,
  },
]

export const sessions: Session[] = [
  {
    id: "sess-transcript",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Wire the collection stream protocol",
    status: "working",
    unseenCount: 2,
    createdAt: MOCK_NOW - 90 * MIN,
    updatedAt: MOCK_NOW - 1 * MIN,
    archived: false,
    shared: false,
  },
  {
    id: "sess-permission",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Rotate the OAuth client secret",
    status: "permission",
    unseenCount: 1,
    createdAt: MOCK_NOW - 40 * MIN,
    updatedAt: MOCK_NOW - 4 * MIN,
    archived: false,
    shared: false,
  },
  {
    id: "sess-question",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Pick a retention window for the changelog",
    status: "question",
    unseenCount: 1,
    createdAt: MOCK_NOW - 3 * HOUR,
    updatedAt: MOCK_NOW - 20 * MIN,
    archived: false,
    shared: false,
  },
  {
    id: "sess-error",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Fix flaky snapshot reconciliation test",
    status: "error",
    unseenCount: 0,
    createdAt: MOCK_NOW - 5 * HOUR,
    updatedAt: MOCK_NOW - 2 * HOUR,
    archived: false,
    shared: false,
  },
  {
    id: "sess-idle-1",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Refactor sidebar resize handle",
    status: "idle",
    unseenCount: 0,
    createdAt: MOCK_NOW - DAY,
    updatedAt: MOCK_NOW - DAY + 2 * HOUR,
    archived: false,
    shared: true,
  },
  {
    id: "sess-idle-2",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Investigate slow cold start",
    status: "idle",
    unseenCount: 0,
    createdAt: MOCK_NOW - 3 * DAY,
    updatedAt: MOCK_NOW - 3 * DAY + HOUR,
    archived: false,
    shared: false,
  },
  {
    id: "sess-archived-1",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Spike: evaluate wa-sqlite bundle cost",
    status: "idle",
    unseenCount: 0,
    createdAt: MOCK_NOW - 10 * DAY,
    updatedAt: MOCK_NOW - 9 * DAY,
    archived: true,
    shared: false,
  },
  {
    id: "sess-marketing-1",
    projectId: "proj-marketing",
    connectionId: "conn-local",
    title: "Rewrite the pricing page copy",
    status: "idle",
    unseenCount: 0,
    createdAt: MOCK_NOW - 3 * HOUR,
    updatedAt: MOCK_NOW - 2 * HOUR,
    archived: false,
    shared: false,
  },
  {
    id: "sess-marketing-2",
    projectId: "proj-marketing",
    connectionId: "conn-local",
    title: "Add OpenGraph images",
    status: "working",
    unseenCount: 3,
    createdAt: MOCK_NOW - 20 * MIN,
    updatedAt: MOCK_NOW - 30_000,
    archived: false,
    shared: false,
  },
  {
    id: "sess-infra-1",
    projectId: "proj-infra",
    connectionId: "conn-local",
    title: "Terraform: bump node pool size",
    status: "idle",
    unseenCount: 0,
    createdAt: MOCK_NOW - 2 * DAY,
    updatedAt: MOCK_NOW - 2 * DAY + HOUR,
    archived: false,
    shared: false,
  },
  {
    id: "sess-docs-1",
    projectId: "proj-docs",
    connectionId: "conn-staging",
    title: "Document the outbox dead-letter view",
    status: "idle",
    unseenCount: 0,
    createdAt: MOCK_NOW - 6 * HOUR,
    updatedAt: MOCK_NOW - 5 * HOUR,
    archived: false,
    shared: false,
  },
]

export const messagesBySession: Record<string, SessionMessage[]> = {
  "sess-transcript": [
    {
      id: "msg-1",
      sessionId: "sess-transcript",
      role: "user",
      createdAt: MOCK_NOW - 90 * MIN,
      text: "Let's wire up the collection stream protocol described in section 5. Start with the snapshot/live handoff.",
    },
    {
      id: "msg-2",
      sessionId: "sess-transcript",
      role: "assistant",
      createdAt: MOCK_NOW - 89 * MIN,
      agent: "build",
      model: "claude-sonnet-5",
      parts: [
        {
          id: "part-2-reasoning",
          kind: "reasoning",
          text: "The snapshot has to come from a single consistent read transaction so baseSeq and throughSeq always match. I'll start by reading the feed metadata table.",
        },
        {
          id: "part-2-tool",
          kind: "tool",
          tool: "read",
          status: "completed",
          input: "packages/hena/src/server/collection/feed.ts",
          output: "230 lines read",
          durationMs: 120,
        },
        {
          id: "part-2-text",
          kind: "text",
          text: "I read the feed metadata table. The `collection_feed` row already tracks `feed_id` and `runtime_id`. I'll add the `collection_change` table next.",
        },
      ],
    },
    {
      id: "msg-3",
      sessionId: "sess-transcript",
      role: "shell",
      createdAt: MOCK_NOW - 87 * MIN,
      command: "bun test packages/hena/src/server/collection",
      output: "12 pass\n0 fail\nRan 12 tests across 3 files. [640.00ms]",
    },
    {
      id: "msg-4",
      sessionId: "sess-transcript",
      role: "assistant",
      createdAt: MOCK_NOW - 85 * MIN,
      agent: "build",
      model: "claude-sonnet-5",
      parts: [
        {
          id: "part-4-tool",
          kind: "tool",
          tool: "edit",
          status: "completed",
          input: "packages/hena/src/server/collection/changelog.ts",
          output: "+42 -3",
          durationMs: 340,
        },
        {
          id: "part-4-text",
          kind: "text",
          text: "Added the `collection_change` table with the `(collection, scope_key, seq)` index. Tests pass.",
        },
      ],
    },
    {
      id: "msg-5",
      sessionId: "sess-transcript",
      role: "agent-switched",
      createdAt: MOCK_NOW - 70 * MIN,
      from: "build",
      to: "plan",
    },
    {
      id: "msg-6",
      sessionId: "sess-transcript",
      role: "user",
      createdAt: MOCK_NOW - 69 * MIN,
      text: "Good. Before continuing, plan out the snapshot state machine from section 5.2 so I can review it.",
    },
    {
      id: "msg-7",
      sessionId: "sess-transcript",
      role: "assistant",
      createdAt: MOCK_NOW - 68 * MIN,
      agent: "plan",
      model: "claude-opus-5",
      parts: [
        {
          id: "part-7-text",
          kind: "text",
          text: "Here's the state machine:\n\n1. Register a live-change buffer for the scope.\n2. Open a consistent read transaction, capture `baseSeq`.\n3. Emit `snapshot.begin`.\n4. Emit bounded `snapshot.page` frames.\n5. Emit `snapshot.end` with `throughSeq === baseSeq`.\n6. Replay buffered ops after `throughSeq`.\n7. Continue with live rows.",
        },
      ],
    },
    {
      id: "msg-8",
      sessionId: "sess-transcript",
      role: "model-switched",
      createdAt: MOCK_NOW - 66 * MIN,
      from: "claude-opus-5",
      to: "claude-sonnet-5",
    },
    {
      id: "msg-9",
      sessionId: "sess-transcript",
      role: "compaction",
      createdAt: MOCK_NOW - 40 * MIN,
      final: true,
      summary:
        "Compacted 14 earlier messages covering table design and the state-machine review into this summary. Full history remains available.",
    },
    {
      id: "msg-10",
      sessionId: "sess-transcript",
      role: "system",
      createdAt: MOCK_NOW - 39 * MIN,
      text: "Context window refreshed after compaction.",
    },
    {
      id: "msg-11",
      sessionId: "sess-transcript",
      role: "agent-switched",
      createdAt: MOCK_NOW - 38 * MIN,
      from: "plan",
      to: "build",
    },
    {
      id: "msg-12",
      sessionId: "sess-transcript",
      role: "user",
      createdAt: MOCK_NOW - 37 * MIN,
      text: "Implement it.",
    },
    {
      id: "msg-13",
      sessionId: "sess-transcript",
      role: "assistant",
      createdAt: MOCK_NOW - 35 * MIN,
      agent: "build",
      model: "claude-sonnet-5",
      parts: [
        {
          id: "part-13-tool-1",
          kind: "tool",
          tool: "write",
          status: "completed",
          input: "packages/hena/src/server/collection/snapshot.ts",
          output: "+118 new file",
          durationMs: 210,
        },
        {
          id: "part-13-tool-2",
          kind: "tool",
          tool: "bash",
          status: "running",
          input: "bun test packages/hena/src/server/collection/snapshot.test.ts",
        },
      ],
    },
    {
      id: "msg-14",
      sessionId: "sess-transcript",
      role: "synthetic",
      createdAt: MOCK_NOW - 34 * MIN,
      text: "Reminder injected by the review checklist: verify throughSeq validation on snapshot.end before merging.",
    },
    {
      id: "msg-15",
      sessionId: "sess-transcript",
      role: "user",
      createdAt: MOCK_NOW - 10 * MIN,
      text: "How's the snapshot test coming along?",
    },
    {
      id: "msg-16",
      sessionId: "sess-transcript",
      role: "assistant",
      createdAt: MOCK_NOW - 1 * MIN,
      agent: "build",
      model: "claude-sonnet-5",
      parts: [
        {
          id: "part-16-reasoning",
          kind: "reasoning",
          text: "Still running the test file; the snapshot/live race test takes a while under the failure-injection harness.",
        },
        {
          id: "part-16-tool",
          kind: "tool",
          tool: "bash",
          status: "running",
          input: "bun test packages/hena/src/server/collection/snapshot.test.ts",
        },
      ],
    },
  ],
  "sess-permission": [
    {
      id: "perm-msg-1",
      sessionId: "sess-permission",
      role: "user",
      createdAt: MOCK_NOW - 40 * MIN,
      text: "Rotate the staging OAuth client secret and update the deployed config.",
    },
    {
      id: "perm-msg-2",
      sessionId: "sess-permission",
      role: "assistant",
      createdAt: MOCK_NOW - 38 * MIN,
      agent: "build",
      model: "claude-sonnet-5",
      parts: [
        {
          id: "perm-part-1",
          kind: "text",
          text: "I need permission to run the secret-rotation script since it writes to the shared credentials store.",
        },
      ],
    },
  ],
  "sess-question": [
    {
      id: "q-msg-1",
      sessionId: "sess-question",
      role: "user",
      createdAt: MOCK_NOW - 3 * HOUR,
      text: "Add retention limits to the changelog table per section 4.2.",
    },
    {
      id: "q-msg-2",
      sessionId: "sess-question",
      role: "assistant",
      createdAt: MOCK_NOW - 3 * HOUR + 2 * MIN,
      agent: "build",
      model: "claude-sonnet-5",
      parts: [
        {
          id: "q-part-1",
          kind: "text",
          text: "Before I implement retention, I need to know which window to enforce.",
        },
      ],
    },
  ],
  "sess-error": [
    {
      id: "err-msg-1",
      sessionId: "sess-error",
      role: "user",
      createdAt: MOCK_NOW - 5 * HOUR,
      text: "The snapshot reconciliation test is flaky in CI. Can you find out why?",
    },
    {
      id: "err-msg-2",
      sessionId: "sess-error",
      role: "assistant",
      createdAt: MOCK_NOW - 4 * HOUR + 50 * MIN,
      agent: "build",
      model: "claude-sonnet-5",
      parts: [
        {
          id: "err-part-1",
          kind: "tool",
          tool: "bash",
          status: "error",
          input: "bun test packages/hena/src/server/collection/snapshot.test.ts --rerun-each 20",
          output: "3 of 20 reruns failed: assertion timeout waiting for snapshot.end",
          durationMs: 48_210,
        },
        {
          id: "err-part-2",
          kind: "text",
          text: "Reproduced it: 3 of 20 reruns fail on a timeout waiting for `snapshot.end`. Looking at the buffered-replay path next.",
        },
      ],
    },
  ],
}

export const todosBySession: Record<string, Todo[]> = {
  "sess-transcript": [
    {
      id: "todo-1",
      sessionId: "sess-transcript",
      text: "Add collection_feed + collection_change tables",
      status: "completed",
    },
    {
      id: "todo-2",
      sessionId: "sess-transcript",
      text: "Implement the snapshot/live handoff state machine",
      status: "in_progress",
    },
    { id: "todo-3", sessionId: "sess-transcript", text: "Add reconnect + retention tests", status: "pending" },
    { id: "todo-4", sessionId: "sess-transcript", text: "Wire the delta ordering buffer", status: "pending" },
  ],
}

export const permissionsBySession: Record<string, PermissionRequest[]> = {
  "sess-permission": [
    {
      id: "perm-req-1",
      sessionId: "sess-permission",
      title: "Run secret-rotation script",
      description: "scripts/rotate-oauth-secret.ts --env staging — writes to the shared credentials store.",
      createdAt: MOCK_NOW - 4 * MIN,
    },
  ],
}

export const questionsBySession: Record<string, QuestionRequest[]> = {
  "sess-question": [
    {
      id: "question-req-1",
      sessionId: "sess-question",
      prompt: "Which retention window should the changelog table enforce?",
      choices: [
        { id: "choice-7d", label: "7 days" },
        { id: "choice-30d", label: "30 days" },
        { id: "choice-unbounded", label: "Unbounded (size-capped only)" },
      ],
      createdAt: MOCK_NOW - 20 * MIN,
    },
  ],
}

// Assigns stable per-line ids (`path:index`) so DiffView never needs an
// array-index React key, which would be unsafe if lines were ever reordered.
function diffLines(path: string, entries: Array<Omit<DiffLine, "id">>): DiffLine[] {
  return entries.map((entry, index) => ({ id: `${path}:${index}`, ...entry }))
}

export const diffFilesBySession: Record<string, DiffFile[]> = {
  "sess-transcript": [
    {
      path: "packages/hena/src/server/collection/changelog.ts",
      kind: "add",
      additions: 42,
      deletions: 3,
      lines: diffLines("packages/hena/src/server/collection/changelog.ts", [
        { kind: "context", text: 'export const collectionFeed = sqliteTable("collection_feed", {' },
        { kind: "context", text: "  id: integer().primaryKey(),\n" },
        { kind: "add", text: "+ feed_id: text().notNull()," },
        { kind: "add", text: "+ retained_floor: integer().notNull()," },
        { kind: "delete", text: "- placeholder: text()," },
        { kind: "context", text: "})" },
      ]),
    },
    {
      path: "packages/hena/src/server/collection/snapshot.ts",
      kind: "add",
      additions: 118,
      deletions: 0,
      lines: diffLines("packages/hena/src/server/collection/snapshot.ts", [
        { kind: "add", text: "+ export function beginSnapshot(scope: ScopeKey) {" },
        { kind: "add", text: "+   const baseSeq = readCurrentSeq()" },
        { kind: "add", text: "+   return { scope, baseSeq }" },
        { kind: "add", text: "+ }" },
      ]),
    },
    {
      path: "packages/hena/src/server/collection/snapshot.test.ts",
      kind: "add",
      additions: 86,
      deletions: 0,
      lines: diffLines("packages/hena/src/server/collection/snapshot.test.ts", [
        { kind: "add", text: '+ test("throughSeq matches baseSeq", () => {' },
        { kind: "add", text: "+   expect(snapshot.throughSeq).toBe(snapshot.baseSeq)" },
        { kind: "add", text: "+ })" },
      ]),
    },
    {
      path: "packages/hena/src/server/collection/feed.ts",
      kind: "mixed",
      additions: 9,
      deletions: 6,
      lines: diffLines("packages/hena/src/server/collection/feed.ts", [
        { kind: "context", text: "export function readFeedMetadata() {" },
        { kind: "delete", text: '-   return db.get("select * from collection_feed")' },
        { kind: "add", text: '+   return db.get("select * from collection_feed where id = 1")' },
        { kind: "context", text: "}" },
      ]),
    },
    {
      path: "packages/hena/src/server/collection/retention.ts",
      kind: "delete",
      additions: 0,
      deletions: 24,
      lines: diffLines("packages/hena/src/server/collection/retention.ts", [
        { kind: "delete", text: "- // superseded by changelog.ts retention helpers" },
        { kind: "delete", text: "- export function pruneOldRows() { /* ... */ }" },
      ]),
    },
  ],
}

export const fileTree: FileNode[] = [
  {
    path: "packages/hena",
    type: "directory",
    children: [
      {
        path: "packages/hena/src",
        type: "directory",
        children: [
          {
            path: "packages/hena/src/server",
            type: "directory",
            children: [
              {
                path: "packages/hena/src/server/collection",
                type: "directory",
                children: [
                  { path: "packages/hena/src/server/collection/changelog.ts", type: "file" },
                  { path: "packages/hena/src/server/collection/snapshot.ts", type: "file" },
                  { path: "packages/hena/src/server/collection/snapshot.test.ts", type: "file" },
                  { path: "packages/hena/src/server/collection/feed.ts", type: "file" },
                  { path: "packages/hena/src/server/collection/retention.ts", type: "file" },
                ],
              },
            ],
          },
        ],
      },
      { path: "packages/hena/package.json", type: "file" },
    ],
  },
]

export const agents: Agent[] = [
  { id: "build", name: "Build", description: "Writes and edits code directly." },
  { id: "plan", name: "Plan", description: "Read-only planning and review." },
  { id: "explore", name: "Explore", description: "Fast codebase search and Q&A." },
]

export const models: Model[] = [
  { id: "claude-sonnet-5", providerId: "anthropic", name: "Claude Sonnet 5", contextWindow: 400_000 },
  { id: "claude-opus-5", providerId: "anthropic", name: "Claude Opus 5", contextWindow: 400_000 },
  { id: "gpt-5.2", providerId: "openai", name: "GPT-5.2", contextWindow: 300_000 },
  { id: "gemini-3-pro", providerId: "google", name: "Gemini 3 Pro", contextWindow: 1_000_000 },
]

export const providers: Provider[] = [
  { id: "anthropic", name: "Anthropic", connected: true },
  { id: "openai", name: "OpenAI", connected: true },
  { id: "google", name: "Google", connected: false },
]

export const mcpServers: McpServer[] = [
  { id: "mcp-github", name: "GitHub", status: "connected" },
  { id: "mcp-linear", name: "Linear", status: "connected" },
  { id: "mcp-sentry", name: "Sentry", status: "error" },
]

export const serverCommands: ServerCommand[] = [
  { id: "cmd-format", name: "Format workspace", description: "Runs the project formatter." },
  { id: "cmd-test", name: "Run tests", description: "Runs the full test suite." },
]
