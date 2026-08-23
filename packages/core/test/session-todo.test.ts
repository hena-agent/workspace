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

      const replacement = yield* todos.update({
        sessionID,
        todos: [{ id: initial[0]!.id, content: "replacement", status: "completed", priority: "medium" }],
      })
      expect(replacement[0]!.id).toBe(initial[0]!.id)
      expect(yield* todos.get(sessionID)).toEqual(replacement)

      yield* todos.update({ sessionID, todos: [] })
      expect(yield* todos.get(sessionID)).toEqual([])
      expect(published.map((event) => event.data)).toEqual([
        {
          sessionID,
          todos: initial,
        },
        { sessionID, todos: replacement },
        { sessionID, todos: [] },
      ])
    }),
  )

  it.effect("rolls back todo rows when a transactional projector fails", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const todos = yield* SessionTodo.Service
      yield* events.project(SessionTodo.Event.Updated, () => Effect.die("projection failed"))

      yield* Effect.exit(todos.update({
        sessionID,
        todos: [{ content: "not committed", status: "pending", priority: "high" }],
      }))

      expect(yield* db.select().from(TodoTable).all().pipe(Effect.orDie)).toEqual([])
    }),
  )

  it.effect("rebuilds todo rows from a durable event", () =>
    Effect.gen(function* () {
      yield* setup
      const events = yield* EventV2.Service
      const todos = yield* SessionTodo.Service
      const todo = { id: SessionTodo.ID.create(), content: "replayed", status: "pending", priority: "high" }

      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SessionTodo.Event.Updated.type, 1),
        seq: 0,
        aggregateID: sessionID,
        data: { sessionID, todos: [todo] },
      })

      expect(yield* todos.get(sessionID)).toEqual([todo])
    }),
  )
})
