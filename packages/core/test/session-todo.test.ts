import { describe, expect } from "bun:test"
import { asc } from "drizzle-orm"
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
  it.effect("preserves server-issued IDs through edits and reorder", () =>
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
      expect(initial).toEqual([
        { id: expect.stringMatching(/^todo_/), content: "second", status: "pending", priority: "low" },
        { id: expect.stringMatching(/^todo_/), content: "first", status: "in_progress", priority: "high" },
      ])
      expect(initial[0]?.id).not.toBe(initial[1]?.id)
      expect(yield* todos.get(sessionID)).toEqual(initial)

      const legacyReordered = yield* todos.update({
        sessionID,
        todos: [
          { content: "first", status: "in_progress", priority: "high" },
          { content: "second", status: "pending", priority: "low" },
        ],
      })
      expect(legacyReordered.map((todo) => todo.id)).toEqual([initial[1]!.id, initial[0]!.id])

      const reordered = yield* todos.update({
        sessionID,
        todos: [
          { content: "second edited", status: "completed", priority: "medium" },
          { content: "first", status: "in_progress", priority: "high" },
        ],
      })
      expect(reordered).toEqual([
        { id: initial[0]!.id, content: "second edited", status: "completed", priority: "medium" },
        { id: initial[1]!.id, content: "first", status: "in_progress", priority: "high" },
      ])
      expect(
        (yield* db.select().from(TodoTable).orderBy(asc(TodoTable.position)).all().pipe(Effect.orDie)).map((row) => ({
          id: row.id,
          content: row.content,
          position: row.position,
        })),
      ).toEqual([
        { id: initial[0]!.id, content: "second edited", position: 0 },
        { id: initial[1]!.id, content: "first", position: 1 },
      ])

      yield* todos.update({ sessionID, todos: [] })
      expect(yield* todos.get(sessionID)).toEqual([])
      expect(published.map((event) => event.data)).toEqual([
        { sessionID, todos: initial },
        { sessionID, todos: legacyReordered },
        { sessionID, todos: reordered },
        { sessionID, todos: [] },
      ])
    }),
  )

  it.effect("rejects unknown and duplicate IDs without changing persisted todos", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const current = yield* todos.update({
        sessionID,
        todos: [{ content: "keep", status: "pending", priority: "low" }],
      })

      expect(
        yield* todos
          .update({
            sessionID,
            todos: [
              {
                id: SessionTodo.ID.make("todo_unknown"),
                content: "unknown",
                status: "pending",
                priority: "low",
              },
            ],
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(SessionTodo.InvalidIDError)
      expect(yield* todos.get(sessionID)).toEqual(current)

      expect(
        yield* todos
          .update({
            sessionID,
            todos: [current[0]!, { ...current[0]!, content: "duplicate" }],
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(SessionTodo.DuplicateIDError)
      expect(yield* todos.get(sessionID)).toEqual(current)
    }),
  )

  it.effect("does not reuse an existing ID for a newly inserted todo", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const current = yield* todos.update({
        sessionID,
        todos: [{ content: "existing", status: "pending", priority: "low" }],
      })

      const updated = yield* todos.update({
        sessionID,
        todos: [
          { content: "new", status: "pending", priority: "high" },
          { content: "existing", status: "pending", priority: "low" },
        ],
      })
      expect(updated[0]?.id).not.toBe(current[0]?.id)
      expect(updated[1]?.id).toBe(current[0]?.id)
    }),
  )

  it.effect("does not reuse a deleted ID for an equal-count replacement", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const current = yield* todos.update({
        sessionID,
        todos: [
          { content: "remove", status: "pending", priority: "low" },
          { content: "keep", status: "pending", priority: "high" },
        ],
      })

      const updated = yield* todos.update({
        sessionID,
        todos: [
          { content: "replacement", status: "pending", priority: "medium" },
          current[1]!,
        ],
      })
      expect(updated[0]?.id).not.toBe(current[0]?.id)
      expect(updated[1]?.id).toBe(current[1]?.id)
    }),
  )
})
