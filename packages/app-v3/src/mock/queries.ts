import type { Connection, Project, Session, SessionMessage } from "@/lib/types"
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

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id)
}

export function listSessions(options: { projectId?: string; includeArchived?: boolean }): Session[] {
  return sessions
    .filter(
      (s) => (!options.projectId || s.projectId === options.projectId) && (options.includeArchived || !s.archived),
    )
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): Session | undefined {
  return sessions.find((s) => s.id === id)
}

export function listMessages(sessionId: string): SessionMessage[] {
  const messages = messagesBySession[sessionId] ?? []
  return messages.toSorted((a, b) => a.createdAt - b.createdAt)
}

export function listTodos(sessionId: string) {
  return todosBySession[sessionId] ?? []
}

export function getPermissionRequest(sessionId: string) {
  return permissionsBySession[sessionId]?.[0]
}

export function getQuestionRequest(sessionId: string) {
  return questionsBySession[sessionId]?.[0]
}

export function listDiffFiles(sessionId: string) {
  return diffFilesBySession[sessionId] ?? []
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

export type ProjectNotification = {
  kind: "none" | "unread" | "permission" | "error"
  working: boolean
}

export function getProjectNotificationState(projectId: string): ProjectNotification {
  const projectSessions = listSessions({ projectId })
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
