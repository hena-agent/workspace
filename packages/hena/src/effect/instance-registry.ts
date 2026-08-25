import type { ProjectV2 } from "@hena/core/project"

const disposers = new Set<(directory: string) => Promise<void>>()
type InstanceProject = { projectID: ProjectV2.ID }
const projects = new Map<string, InstanceProject>()

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string) {
  deleteInstanceProject(directory)
  await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
}

export function markInstanceProject(directory: string, projectID: ProjectV2.ID) {
  const marker = { projectID }
  projects.set(directory, marker)
  return marker
}

export function instanceProject(directory: string) {
  return projects.get(directory)
}

export function clearInstanceProject(directory: string, marker: InstanceProject) {
  if (projects.get(directory) !== marker) return
  projects.delete(directory)
}

export function deleteInstanceProject(directory: string) {
  projects.delete(directory)
}
