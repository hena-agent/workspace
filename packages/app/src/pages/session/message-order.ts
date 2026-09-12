export function splitAtMessage<T extends { id: string }>(messages: T[], id: string) {
  const index = messages.findIndex((message) => message.id === id)
  if (index < 0) return { before: messages, after: [] as T[], at: undefined }
  return { before: messages.slice(0, index), after: messages.slice(index + 1), at: messages[index] }
}
