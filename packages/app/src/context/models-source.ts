export function modelCatalogKey(input: { directory?: string; managedChat: boolean; scope: string }) {
  if (!input.directory || !input.managedChat) return
  return { directory: input.directory, scope: input.scope }
}
