import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$connectionId/settings/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$connectionId/settings/$section",
      params: { connectionId: params.connectionId, section: "general" },
    })
  },
})
