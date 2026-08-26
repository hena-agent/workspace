export function viteApiProxy(target: string) {
  return { target, changeOrigin: true as const }
}
