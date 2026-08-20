import type { Connection, Project, ProjectNotification, Session, SessionMessage } from "@/lib/types"
import {
  agents,
  connections,
  diffFilesBySession,
  fileTree,
  mcpServers,
  messagesBySession,
  models,
  permissionsBySession,
  projects,
  providers,
  questionsBySession,
  serverCommands,
  sessions,
  todosBySession,
} from "./fixtures"

const DAY_MS = 24 * 60 * 60 * 1000

export function listConnections(): Connection[] {
  return connections
}

export function getConnection(id: string): Connection | undefined {
  return connections.find((c) => c.id === id)
}

export function listProjects(connectionId?: string): Project[] {
  if (!connectionId) return projects
  return projects.filter((p) => p.connectionId === connectionId)
}

export function getProject(options: { id: string; connectionId: string }): Project | undefined {
  return projects.find((project) => project.id === options.id && project.connectionId === options.connectionId)
}

export function listSessions(options: {
  projectId?: string
  connectionId?: string
  includeArchived?: boolean
}): Session[] {
  return sessions
    .filter(
      (session) =>
        (!options.projectId || session.projectId === options.projectId) &&
        (!options.connectionId || session.connectionId === options.connectionId) &&
        (options.includeArchived || !session.archived),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(options: { id: string; connectionId: string; projectId: string }): Session | undefined {
  return sessions.find(
    (session) =>
      session.id === options.id &&
      session.connectionId === options.connectionId &&
      session.projectId === options.projectId,
  )
}

export function listMessages(options: {
  sessionId: string
  connectionId: string
  projectId: string
}): SessionMessage[] {
  const messages = messagesBySession[sessionDataKey(options)] ?? []
  return Array.from(messages).sort((a, b) => a.createdAt - b.createdAt)
}

export function listTodos(options: { sessionId: string; connectionId: string; projectId: string }) {
  return todosBySession[sessionDataKey(options)] ?? []
}

export function getPermissionRequest(options: { sessionId: string; connectionId: string; projectId: string }) {
  return permissionsBySession[sessionDataKey(options)]?.[0]
}

export function getQuestionRequest(options: { sessionId: string; connectionId: string; projectId: string }) {
  return questionsBySession[sessionDataKey(options)]?.[0]
}

export function listDiffFiles(options: { sessionId: string; connectionId: string; projectId: string }) {
  return diffFilesBySession[sessionDataKey(options)] ?? []
}

export function getFileTree() {
  return fileTree
}

export function listAgents() {
  return agents
}

export function listModels() {
  return models
}

export function listProviders() {
  return providers
}

export function listMcpServers() {
  return mcpServers
}

export function listServerCommands() {
  return serverCommands
}

export function getProjectNotificationState(options: { projectId: string; connectionId: string }): ProjectNotification {
  const projectSessions = listSessions(options)
  const working = projectSessions.some((s) => s.status === "working")

  if (projectSessions.some((s) => s.status === "permission" || s.status === "question")) {
    return { kind: "permission", working }
  }
  if (projectSessions.some((s) => s.status === "error")) {
    return { kind: "error", working }
  }
  if (projectSessions.some((s) => s.unseenCount > 0)) {
    return { kind: "unread", working }
  }
  return { kind: "none", working }
}

export function groupSessionsByRecency(list: Session[], now: number) {
  const startOfToday = now - (now % DAY_MS)
  const startOfYesterday = startOfToday - DAY_MS

  return {
    today: list.filter((s) => s.updatedAt >= startOfToday),
    yesterday: list.filter((s) => s.updatedAt >= startOfYesterday && s.updatedAt < startOfToday),
    older: list.filter((s) => s.updatedAt < startOfYesterday),
  }
}

function sessionDataKey(options: { sessionId: string; connectionId: string; projectId: string }) {
  return `${options.connectionId}:${options.projectId}:${options.sessionId}`
}
