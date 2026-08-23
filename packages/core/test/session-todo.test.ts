import { describe, expect } from "bun:test"
import { asc, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@hena/core/database/database"
import { LayerNode } from "@hena/core/effect/layer-node"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { EventV2 } from "@hena/core/event"
import { Project } from "@hena/core/project"
import { ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { SessionTable, TodoTable } from "@hena/core/session/sql"
import { SessionTodo } from "@hena/core/session/todo"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionTodo.node])))
const sessionID = SessionV2.ID.make("ses_todo_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todo",
      directory: "/project",
      title: "todo",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

describe("SessionTodo", () => {
  it.effect("repairs rollback-created todos before returning them", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      yield* db
        .run(
          sql`
        INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
        VALUES (${sessionID}, 'rollback todo', 'pending', 'high', 0, 1, 1)
      `,
        )
        .pipe(Effect.orDie)

      const listed = yield* (yield* SessionTodo.Service).get(sessionID)

      expect(listed[0]?.id).toMatch(/^todo_/)
      expect(yield* db.get(sql`SELECT id FROM todo WHERE session_id = ${sessionID}`)).toEqual({ id: listed[0]?.id })
    }),
  )

  it.effect("replaces persisted todos in order and publishes updates", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const todos = yield* SessionTodo.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTodo.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      const initial = yield* todos.update({
        sessionID,
        todos: [
          { content: "second", status: "pending", priority: "low" },
          { content: "first", status: "in_progress", priority: "high" },
        ],
      })
      expect(initial.every((todo) => todo.id?.startsWith("todo_"))).toBe(true)
      expect(yield* todos.get(sessionID)).toEqual(initial)
      expect(
        (yield* db.select().from(TodoTable).orderBy(asc(TodoTable.position)).all().pipe(Effect.orDie)).map((row) => ({
          content: row.content,
          position: row.position,
        })),
      ).toEqual([
        { content: "second", position: 0 },
        { content: "first", position: 1 },
      ])

      const edited = yield* todos.update({
        sessionID,
        todos: [
          { ...initial[0], content: "second edited", status: "in_progress", priority: "low" },
          { ...initial[1], content: "first edited", status: "completed", priority: "high" },
        ],
      })
      expect(edited.map((todo) => todo.id)).toEqual(initial.map((todo) => todo.id))

      const replacement = yield* todos.update({
        sessionID,
        todos: [{ id: edited[0]!.id, content: "replacement", status: "completed", priority: "medium" }],
      })
      expect(replacement[0]!.id).toBe(edited[0]!.id)
      expect(yield* todos.get(sessionID)).toEqual(replacement)

      yield* todos.update({ sessionID, todos: [] })
      expect(yield* todos.get(sessionID)).toEqual([])
      expect(published.map((event) => event.data)).toEqual([
        {
          sessionID,
          todos: initial,
        },
        { sessionID, todos: edited },
        { sessionID, todos: replacement },
        { sessionID, todos: [] },
      ])
    }),
  )

  it.effect("assigns new identities to todos that omit IDs", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const initial = yield* todos.update({
        sessionID,
        todos: [
          { content: "first", status: "pending", priority: "high" },
          { content: "second", status: "pending", priority: "low" },
        ],
      })

      const reordered = yield* todos.update({
        sessionID,
        todos: [
          { content: "inserted", status: "pending", priority: "medium" },
          { content: "second", status: "pending", priority: "low" },
          { content: "first", status: "pending", priority: "high" },
        ],
      })

      expect(reordered.map((todo) => todo.id)).not.toContain(initial[0].id)
      expect(reordered.map((todo) => todo.id)).not.toContain(initial[1].id)
    }),
  )

  it.effect("rejects duplicate and foreign todo identities with typed conflicts", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const todos = yield* SessionTodo.Service
      const duplicateID = SessionTodo.ID.create()
      const duplicate = yield* todos.update({
        sessionID,
        todos: [
          { id: duplicateID, content: "first", status: "pending", priority: "high" },
          { id: duplicateID, content: "second", status: "pending", priority: "low" },
        ],
      }).pipe(Effect.flip)
      expect(duplicate).toMatchObject({
        _tag: "Session.TodoConflictError",
        sessionID,
        todoID: duplicateID,
        reason: "duplicate",
      })

      const existing = yield* todos.update({
        sessionID,
        todos: [{ content: "owned", status: "pending", priority: "high" }],
      })
      const otherSessionID = SessionV2.ID.make("ses_todo_other")
      yield* db.insert(SessionTable).values({
        id: otherSessionID,
        project_id: Project.ID.global,
        slug: "other",
        directory: "/project",
        title: "other",
        version: "test",
      }).run().pipe(Effect.orDie)
      const foreign = yield* todos.update({
        sessionID: otherSessionID,
        todos: [{ ...existing[0], content: "stolen" }],
      }).pipe(Effect.flip)
      expect(foreign).toMatchObject({
        _tag: "Session.TodoConflictError",
        sessionID: otherSessionID,
        todoID: existing[0].id,
        reason: "owned_by_another_session",
      })
    }),
  )

  it.effect("rolls back todo rows when a live projector fails", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const todos = yield* SessionTodo.Service
      yield* db
        .run(
          sql`
        INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id)
        VALUES (1, 'feed', 0, 'runtime')
      `,
        )
        .pipe(Effect.orDie)
      yield* events.project(SessionTodo.Event.Updated, () =>
        Effect.gen(function* () {
          yield* db
            .run(
              sql`
            INSERT INTO collection_row (collection, scope_key, row_key, row, row_revision)
            VALUES ('todos', ${sessionID}, 'todo_projected', '{}', '1')
          `,
            )
            .pipe(Effect.orDie)
          yield* Effect.die("projection failed")
        }),
      )

      yield* Effect.exit(
        todos.update({
          sessionID,
          todos: [{ content: "not committed", status: "pending", priority: "high" }],
        }),
      )

      expect(yield* db.select().from(TodoTable).all().pipe(Effect.orDie)).toEqual([])
      expect(yield* db.all(sql`SELECT row_key FROM collection_row WHERE collection = 'todos'`)).toEqual([])
    }),
  )
})
