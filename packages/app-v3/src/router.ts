import { createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

export function createAppRouter() {
  return createRouter({ routeTree, basepath: import.meta.env.BASE_URL })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter
  }
}
