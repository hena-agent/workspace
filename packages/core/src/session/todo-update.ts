export * as SessionTodoUpdate from "./todo-update"

import { SessionTodo } from "@hena/schema/session-todo"

export class InvalidIDError extends Error {
  override readonly name = "InvalidIDError"
  constructor(readonly id: SessionTodo.ID) {
    super(`Unknown todo ID: ${id}`)
  }
}

export class DuplicateIDError extends Error {
  override readonly name = "DuplicateIDError"
  constructor(readonly id: SessionTodo.ID) {
    super(`Duplicate todo ID: ${id}`)
  }
}

export function prepare<Existing extends SessionTodo.Info>(
  existing: ReadonlyArray<Existing>,
  input: ReadonlyArray<SessionTodo.Input>,
) {
  const existingByID = new Map(existing.map((todo) => [todo.id, todo]))
  const suppliedIDs = input.flatMap((todo) => (todo.id === undefined ? [] : [todo.id]))
  const duplicate = suppliedIDs.find((id, index) => suppliedIDs.indexOf(id) !== index)
  if (duplicate !== undefined) return { ok: false, error: new DuplicateIDError(duplicate) } as const
  const invalid = suppliedIDs.find((id) => !existingByID.has(id))
  if (invalid !== undefined) return { ok: false, error: new InvalidIDError(invalid) } as const
  const claimed = new Set(suppliedIDs)
  const exactByPosition = new Map<number, Existing>()
  input.forEach((todo, position) => {
    if (todo.id !== undefined) return
    const exact = existing.find(
      (candidate) =>
        !claimed.has(candidate.id) &&
        candidate.content === todo.content &&
        candidate.status === todo.status &&
        candidate.priority === todo.priority,
    )
    if (!exact) return
    claimed.add(exact.id)
    exactByPosition.set(position, exact)
  })
  const unmatchedPositions = input
    .map((todo, position) => (todo.id === undefined && !exactByPosition.has(position) ? position : undefined))
    .filter((position): position is number => position !== undefined)
  const positionedByPosition = new Map(
    input.length === existing.length && suppliedIDs.length === 0
      ? unmatchedPositions.map((position, index) => [
          position,
          existing.filter((todo) => !claimed.has(todo.id))[index],
        ])
      : [],
  )
  return {
    ok: true,
    existingByID,
    todos: input.map((todo, position) => {
      if (todo.id !== undefined) return { ...todo, id: todo.id }
      const matched = exactByPosition.get(position) ?? positionedByPosition.get(position)
      return { ...todo, id: matched?.id ?? SessionTodo.ID.create() }
    }),
  } as const
}
