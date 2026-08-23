import { afterEach, describe, expect, test } from "bun:test"
import { bootstrapCollections, bootstrapLocationCollections } from "../src/core/bootstrap"
import { unavailableCoreDomain } from "../src/core/domain"
import { createOnlineRequestStore } from "../src/core/online-requests"
import { createTestDatabase } from "./fixture"
import type { SyncDatabase } from "../src/storage/database"

describe("collection bootstrap", () => {
  let database: SyncDatabase | undefined
  afterEach(() => database?.close())

  test("hydrates existing projects and every session collection", () => {
    database = createTestDatabase().database
    database.raw.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY, worktree TEXT NOT NULL, vcs TEXT, name TEXT, icon_url TEXT,
        icon_url_override TEXT, icon_color TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
        time_initialized INTEGER, sandboxes TEXT NOT NULL, commands TEXT
      );
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT, parent_id TEXT, directory TEXT NOT NULL,
        path TEXT, title TEXT NOT NULL, agent TEXT, model TEXT, cost REAL NOT NULL, tokens_input INTEGER NOT NULL,
        tokens_output INTEGER NOT NULL, tokens_reasoning INTEGER NOT NULL, tokens_cache_read INTEGER NOT NULL,
        tokens_cache_write INTEGER NOT NULL, revert TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
        time_archived INTEGER, queue_revision INTEGER NOT NULL
      );
      CREATE TABLE session_message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE session_input (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL, delivery TEXT NOT NULL,
        admitted_seq INTEGER NOT NULL, queue_position INTEGER NOT NULL, promoted_seq INTEGER, time_created INTEGER NOT NULL
      );
      CREATE TABLE todo (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
        priority TEXT NOT NULL, position INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      INSERT INTO project VALUES ('global', '/repo', 'git', 'Repo', NULL, NULL, NULL, 1, 2, NULL, '[]', NULL);
      INSERT INTO session VALUES ('ses_1', 'global', NULL, NULL, '/repo', NULL, 'Test', NULL, NULL, 0, 0, 0, 0, 0, 0, NULL, 3, 4, NULL, 2);
      INSERT INTO session_message VALUES (
        'msg_1', 'ses_1', 'assistant', 1, 5, 6,
        '{"time":{"created":5},"agent":"build","model":{"id":"model","providerID":"provider"},"content":[{"type":"text","id":"part_1","text":"answer"}]}'
      );
      INSERT INTO session_input VALUES (
        'msg_2', 'ses_1', '{"text":"queued","files":[],"agents":[]}', 'queue', 2, 0, NULL, 7
      );
      INSERT INTO todo VALUES ('todo_1', 'ses_1', 'Ship it', 'pending', 'high', 0, 8, 9);
    `)

    bootstrapCollections(database)

    expect(database.collections.snapshot("projects", "").rows[0]?.row).toMatchObject({ id: "global", name: "Repo" })
    expect(database.collections.snapshot("sessions", "").rows[0]?.row).toMatchObject({ id: "ses_1", queueRevision: 2 })
    expect(database.collections.snapshot("locations", "").rows[0]?.row).toEqual({ directory: "/repo" })
    expect(database.collections.snapshot("messages", "ses_1").rows[0]?.row).toMatchObject({
      id: "msg_1",
      type: "assistant",
    })
    expect(database.collections.snapshot("parts", "ses_1").rows[0]?.row).toMatchObject({
      id: "part_1",
      messageID: "msg_1",
    })
    expect(database.collections.snapshot("sessionInputs", "ses_1").rows[0]?.row).toMatchObject({
      id: "msg_2",
      delivery: "queue",
    })
    expect(database.collections.snapshot("todos", "ses_1").rows[0]?.row).toMatchObject({
      id: "todo_1",
      content: "Ship it",
    })
    expect(database.changes.after("projects", "", 0)).toEqual([])
  })

  test("hydrates redacted location catalogs without request secrets", async () => {
    database = createTestDatabase().database
    database.collections.hydrate("locations", "", [
      {
        key: '{"directory":"/repo"}',
        row: { directory: "/repo" },
        revision: "1",
      },
    ])
    const domain = {
      ...unavailableCoreDomain(),
      catalog: async () => ({
        agents: [
          {
            id: "build",
            mode: "all",
            hidden: false,
            permissions: [],
            request: { headers: { Authorization: "secret" }, body: { apiKey: "secret" } },
          } as never,
        ],
        models: [
          {
            id: "model-1",
            providerID: "provider-1",
            name: "Model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: [],
            time: { released: 0 },
            cost: [],
            status: "active",
            enabled: true,
            limit: { context: 1000, output: 100 },
            api: {},
            request: { headers: { Authorization: "secret" }, body: { apiKey: "secret" } },
          } as never,
        ],
        providers: [
          {
            id: "provider-1",
            name: "Provider",
            api: {},
            request: { headers: { Authorization: "secret" }, body: { apiKey: "secret" } },
          } as never,
        ],
      }),
    }

    const online = createOnlineRequestStore()
    await bootstrapLocationCollections(database, domain, online)

    const rows = [
      ...online.snapshot("agents", '{"directory":"/repo"}').rows,
      ...online.snapshot("models", '{"directory":"/repo"}').rows,
      ...online.snapshot("providers", '{"directory":"/repo"}').rows,
    ]
    expect(rows).toHaveLength(3)
    expect(JSON.stringify(rows)).not.toContain("secret")
    expect(database.changes.current()).toBe(0)
  })
})
