import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/review")({
  validateSearch: (search: Record<string, unknown>) => ({
    file: typeof search.file === "string" && search.file.length <= 1024 ? search.file : undefined,
  }),
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$connectionId/$projectId/session/$sessionId", params })
  },
})
