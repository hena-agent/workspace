import type {
  EventSessionNextPrompted,
  Message,
  Part,
  Session,
  SessionMessage,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from "@hena/sdk/v2/client"

export function mapV2Prompted(value: EventSessionNextPrompted["properties"], session?: Session) {
  return mapV2Messages(
    [{ type: "user", id: value.messageID, time: { created: value.timestamp }, ...value.prompt, ...value.selection }],
    value.sessionID,
    session,
  )
}

// Canonical storage records are translated at the boundary; cache ownership stays in server-session.
export function mapV2Messages(values: SessionMessage[], sessionID: string, session?: Session) {
  let parentID = ""
  let agent = session?.agent ?? ""
  let model = session?.model
  const sessionMessages: Message[] = []
  const parts: { id: string; part: Part[] }[] = []
  for (const value of values) {
    if (value.type === "agent-switched") {
      agent = value.agent
      continue
    }
    if (value.type === "model-switched") {
      model = value.model
      continue
    }
    if (value.type === "system" || value.type === "synthetic") continue
    if (value.type === "user" || value.type === "shell" || value.type === "compaction") {
      if (value.type === "user") {
        agent = value.agent ?? agent
        model = value.model ?? model
      }
      sessionMessages.push({
        id: value.id,
        sessionID,
        role: "user",
        time: { created: value.time.created },
        agent,
        model: { providerID: model?.providerID ?? "", modelID: model?.id ?? "", variant: model?.variant },
      })
      if (value.type === "user") parentID = value.id
      const content: Part[] = []
      if (value.type === "compaction")
        content.push({
          id: `${value.id}:compaction`,
          sessionID,
          messageID: value.id,
          type: "compaction",
          auto: value.reason === "auto",
        })
      content.push({
        id: `${value.id}:text`,
        sessionID,
        messageID: value.id,
        type: "text",
        text:
          value.type === "user"
            ? value.text
            : value.type === "shell"
              ? `${value.command}\n${value.output}`
              : value.summary,
        synthetic: value.type === "compaction" ? true : undefined,
      })
      if (value.type === "user") {
        content.push(
          ...(value.files ?? []).map(
            (file, index): Part => ({
              id: `${value.id}:file:${index}`,
              sessionID,
              messageID: value.id,
              type: "file",
              url: file.uri,
              mime: file.mime,
              filename: file.name,
              source: file.source
                ? {
                    type: "file",
                    path: file.uri,
                    text: { value: file.source.text, start: file.source.start, end: file.source.end },
                  }
                : undefined,
            }),
          ),
        )
        content.push(
          ...(value.agents ?? []).map(
            (attachment, index): Part => ({
              id: `${value.id}:agent:${index}`,
              sessionID,
              messageID: value.id,
              type: "agent",
              name: attachment.name,
              source: attachment.source
                ? { value: attachment.source.text, start: attachment.source.start, end: attachment.source.end }
                : undefined,
            }),
          ),
        )
      }
      parts.push({ id: value.id, part: content })
      continue
    }
    sessionMessages.push(mapV2Assistant(value, sessionID, parentID, session?.directory ?? ""))
    parts.push({
      id: value.id,
      part: value.content.map((part) => mapV2Part(part, sessionID, value.id, value.time.created)),
    })
  }
  return { session: sessionMessages, part: parts }
}

export function mapV2Assistant(
  value: Pick<
    Extract<SessionMessage, { type: "assistant" }>,
    "id" | "time" | "model" | "agent" | "cost" | "tokens" | "finish" | "error"
  >,
  sessionID: string,
  parentID: string,
  directory: string,
): Extract<Message, { role: "assistant" }> {
  return {
    id: value.id,
    sessionID,
    role: "assistant",
    time: { created: value.time.created, completed: value.time.completed },
    parentID,
    modelID: value.model.id,
    providerID: value.model.providerID,
    mode: value.agent,
    agent: value.agent,
    path: { cwd: directory, root: directory },
    cost: value.cost ?? 0,
    tokens: value.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: value.finish,
    error: value.error ? { name: "UnknownError", data: { message: value.error.message } } : undefined,
    variant: value.model.variant,
  }
}

function mapV2Part(
  value: SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool,
  sessionID: string,
  messageID: string,
  created: number,
): Part {
  const base = { id: value.id, sessionID, messageID }
  if (value.type === "text") return { ...base, type: value.type, text: value.text }
  if (value.type === "reasoning")
    return {
      ...base,
      type: value.type,
      text: value.text,
      time: { start: value.time?.created ?? created, end: value.time?.completed },
      metadata: value.providerMetadata,
    }
  const state = value.state
  return {
    ...base,
    type: "tool",
    callID: value.id,
    tool: value.name,
    state:
      state.status === "completed"
        ? {
            status: "completed",
            input: state.input,
            output: JSON.stringify(state.result ?? state.content) ?? "",
            title: value.name,
            metadata: { structured: state.structured },
            time: {
              start: value.time.ran ?? value.time.created,
              end: value.time.completed ?? value.time.created,
              compacted: value.time.pruned,
            },
          }
        : state.status === "error"
          ? {
              status: "error",
              input: state.input,
              error: state.error.message,
              time: { start: value.time.ran ?? value.time.created, end: value.time.completed ?? value.time.created },
            }
          : state.status === "running"
            ? {
                status: "running",
                input: state.input,
                time: { start: value.time.ran ?? value.time.created },
                metadata: { structured: state.structured },
              }
            : { status: "pending", input: {}, raw: state.input },
  }
}
