import { afterEach, describe, expect, test } from "bun:test"
import {
  bootstrapCollections,
  bootstrapLocationCollections,
  createLocationCollectionRefresh,
} from "../src/core/bootstrap"
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
      INSERT INTO todo VALUES (NULL, 'ses_1', 'Ship it', 'pending', 'high', 0, 8, 9);
    `)
    const uri = `data:text/plain;base64,${"A".repeat(40 * 1024)}`
    const largeOutput = "B".repeat(40 * 1024)
    database.raw.query("UPDATE session_message SET data = ? WHERE id = 'msg_1'").run(
      JSON.stringify({
        time: { created: 5 },
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "text", id: "part_1", text: largeOutput },
          { type: "text", id: "part_2", text: "initial" },
          {
            type: "tool",
            id: "part_pending",
            name: "bash",
            state: { status: "pending", input: "C".repeat(2 * 1024 * 1024) },
            time: { created: 5 },
          },
          {
            type: "tool",
            id: "part_completed",
            name: "bash",
            state: {
              status: "completed",
              input: { value: "D".repeat(2 * 1024 * 1024) },
              structured: { value: "E".repeat(2 * 1024 * 1024) },
              content: [],
            },
            time: { created: 5, completed: 6 },
          },
        ],
      }),
    )
    database.raw.query("UPDATE session_input SET prompt = ? WHERE id = 'msg_2'").run(
      JSON.stringify({
        text: "queued",
        files: [{ uri }],
      }),
    )
    database.raw
      .query("INSERT INTO session_message VALUES ('msg_3', 'ses_1', 'user', 2, 7, 7, ?)")
      .run(JSON.stringify({ time: { created: 7 }, text: "promoted", files: [{ uri, mime: "text/plain" }], agents: [] }))
    database.raw
      .query("INSERT INTO session_message VALUES ('msg_4', 'ses_1', 'shell', 3, 8, 8, ?)")
      .run(JSON.stringify({ time: { created: 8 }, callID: "call_1", command: "build", output: "F".repeat(2 * 1024 * 1024) }))
    database.raw
      .query("UPDATE session SET path = '', model = ? WHERE id = 'ses_1'")
      .run(JSON.stringify({ id: "model", providerID: "provider" }))
    database.collections.hydrate("parts", "ses_deleted", [
      {
        key: "part-deleted",
        row: { content: { id: "content-deleted", revision: "r1", bytes: 7 } },
        revision: "r1",
      },
    ])
    database.content.put({ id: "content-deleted", sessionID: "ses_deleted", revision: "r1", text: "deleted" })

    expect(bootstrapCollections(database)).toBe(true)

    expect(database.collections.snapshot("projects", "").rows[0]?.row).toMatchObject({ id: "global", name: "Repo" })
    expect(database.collections.snapshot("sessions", "").rows[0]?.row).toMatchObject({
      id: "ses_1",
      queueRevision: 2,
      model: { id: "model", providerID: "provider", variant: "default" },
    })
    expect(database.collections.snapshot("sessions", "").rows[0]?.row).not.toHaveProperty("subpath")
    const sessionRevision = database.collections.snapshot("sessions", "").rows[0]?.revision
    expect(database.collections.snapshot("locations", "").rows[0]?.row).toEqual({ directory: "/repo" })
    expect(database.collections.snapshot("messages", "ses_1").rows[0]?.row).toMatchObject({
      id: "msg_1",
      type: "assistant",
    })
    expect(database.collections.snapshot("messages", "ses_1").rows[1]?.row).toMatchObject({
      id: "msg_3",
      type: "user",
      files: [{ truncated: true, content: { bytes: uri.length } }],
    })
    expect(database.collections.snapshot("messages", "ses_1").rows[2]?.row).toMatchObject({
      id: "msg_4",
      type: "shell",
      truncated: true,
      content: { bytes: 2 * 1024 * 1024 },
    })
    expect(database.collections.snapshot("parts", "ses_1").rows[0]?.row).toMatchObject({
      id: "part_1",
      messageID: "msg_1",
      truncated: true,
    })
    const toolParts = database.collections
      .snapshot("parts", "ses_1")
      .rows.filter((part) => part.key.includes("part_pending") || part.key.includes("part_completed"))
    expect(JSON.stringify(toolParts).length).toBeLessThan(1024 * 1024)
    expect(toolParts).toHaveLength(2)
    expect(database.collections.snapshot("sessionInputs", "ses_1").rows[0]?.row).toMatchObject({
      id: "msg_2",
      delivery: "queue",
      queueRevision: 2,
      prompt: { files: [{ truncated: true, content: { bytes: uri.length } }] },
    })
    const projected = database.collections.snapshot("sessionInputs", "ses_1").rows[0]!.row as {
      prompt: { files: Array<{ content: { id: string; revision: string } }> }
    }
    expect(
      database.content.page({
        ...projected.prompt.files[0]!.content,
        sessionID: "ses_1",
        offset: 0,
        limit: 256 * 1024,
      })?.text,
    ).toBe(uri)
    expect(database.collections.snapshot("todos", "ses_1").rows[0]?.row).toMatchObject({
      id: expect.stringMatching(/^todo_/),
      content: "Ship it",
    })
    expect(database.collections.snapshot("parts", "ses_deleted").rows).toEqual([])
    expect(
      database.content.page({
        id: "content-deleted",
        sessionID: "ses_deleted",
        revision: "r1",
        offset: 0,
        limit: 10,
      }),
    ).toBeUndefined()
    expect(database.changes.after("projects", "", 0)).toEqual([])
    expect(bootstrapCollections(database)).toBe(false)
    const initialParts = database.collections.snapshot("parts", "ses_1").rows
    database.raw.query("UPDATE session_message SET data = ? WHERE id = 'msg_1'").run(
      JSON.stringify({
        time: { created: 5 },
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "text", id: "part_1", text: largeOutput },
          { type: "text", id: "part_2", text: "updated" },
        ],
      }),
    )
    expect(bootstrapCollections(database)).toBe(true)
    const updatedParts = database.collections.snapshot("parts", "ses_1").rows
    expect(updatedParts.find((part) => part.key.includes("part_1"))?.revision).toBe(
      initialParts.find((part) => part.key.includes("part_1"))?.revision,
    )
    expect(updatedParts.find((part) => part.key.includes("part_2"))?.revision).not.toBe(
      initialParts.find((part) => part.key.includes("part_2"))?.revision,
    )
    expect(
      database.raw
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM full_content WHERE id = 'msg_1_part_1_text'")
        .get(),
    ).toEqual({ count: 1 })
    database.raw.exec("UPDATE session SET queue_revision = 3 WHERE id = 'ses_1'")
    expect(bootstrapCollections(database)).toBe(true)
    expect(database.collections.snapshot("sessions", "").rows[0]?.revision).not.toBe(sessionRevision)
    expect(database.collections.snapshot("sessions", "").rows[0]?.row).toMatchObject({ queueRevision: 3 })
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

  test("serializes catalog refreshes so older results cannot win", async () => {
    database = createTestDatabase().database
    database.collections.hydrate("locations", "", [
      {
        key: '{"directory":"/repo"}',
        row: { directory: "/repo" },
        revision: "1",
      },
    ])
    const first = Promise.withResolvers<void>()
    let calls = 0
    const domain = {
      ...unavailableCoreDomain(),
      catalog: async () => {
        calls++
        if (calls === 1) await first.promise
        return { agents: [{ id: `build-${calls}` } as never], models: [], providers: [] }
      },
    }
    const online = createOnlineRequestStore()
    const refresh = createLocationCollectionRefresh(database, domain, online)

    const older = refresh.run()
    await Promise.resolve()
    const newer = refresh.run()
    first.resolve()
    await Promise.all([older, newer])

    expect(online.snapshot("agents", '{"directory":"/repo"}').rows[0]?.row).toMatchObject({ id: "build-2" })
  })

  test("waits for every location when a catalog refresh fails", async () => {
    database = createTestDatabase().database
    database.collections.hydrate("locations", "", [
      { key: '{"directory":"/fail"}', row: { directory: "/fail" }, revision: "1" },
      { key: '{"directory":"/slow"}', row: { directory: "/slow" }, revision: "1" },
    ])
    const slow = Promise.withResolvers<void>()
    const domain = {
      ...unavailableCoreDomain(),
      catalog: async (location: { directory: string }) => {
        if (location.directory === "/fail") throw new Error("failed")
        await slow.promise
        return { agents: [], models: [], providers: [] }
      },
    }
    let settled = false

    const refresh = bootstrapLocationCollections(database, domain, createOnlineRequestStore()).catch(() => {
      settled = true
    })
    await Bun.sleep(10)

    expect(settled).toBe(false)
    slow.resolve()
    await refresh
    expect(settled).toBe(true)
  })

  test("removes catalogs for locations that no longer exist", async () => {
    database = createTestDatabase().database
    const online = createOnlineRequestStore()
    online.replace("agents", '{"directory":"/removed"}', [{ key: "stale", row: { id: "stale" } }])

    await bootstrapLocationCollections(database, unavailableCoreDomain(), online)

    expect(online.snapshot("agents", '{"directory":"/removed"}').rows).toEqual([])
  })
})
