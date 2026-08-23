import { describe, expect } from "bun:test"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { Project } from "@hena/core/project"
import { ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { SessionTable } from "@hena/core/session/sql"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Todo } from "@/session/todo"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Todo.node])))
const sessionID = SessionID.make("ses_legacy_todo")

describe("legacy session todos", () => {
  it.effect("reuses persisted IDs for updates that omit them", () =>
    Effect.gen(function* () {
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
      yield* db.run(sql`
        INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
        VALUES (${sessionID}, 'rollback todo', 'pending', 'high', 0, 1, 1)
      `).pipe(Effect.orDie)
      const todos = yield* Todo.Service

      const initial = yield* todos.update({
        sessionID,
        todos: [
          { content: "first", status: "pending", priority: "high" },
          { content: "second", status: "pending", priority: "low" },
        ],
      })
      const listed = yield* todos.get(sessionID)
      const updated = yield* todos.update({
        sessionID,
        todos: [...listed].reverse(),
      })

      expect(initial.map((todo) => todo.id)).toEqual(initial.map(() => expect.stringMatching(/^todo_/)))
      expect(listed.map((todo) => todo.id)).toEqual(initial.map((todo) => todo.id))
      expect(updated.map((todo) => todo.id)).toEqual([initial[1]?.id, initial[0]?.id])
    }),
  )
})
