import type { CoreDomain } from "./domain"

export function catalogView(catalog: Awaited<ReturnType<CoreDomain["catalog"]>>) {
  return {
    agents: catalog.agents.map((agent) => ({
      id: agent.id,
      model: agent.model,
      description: agent.description,
      mode: agent.mode,
      hidden: agent.hidden,
      color: agent.color,
      steps: agent.steps,
      permissions: agent.permissions,
    })),
    models: catalog.models.map((model) => ({
      id: model.id,
      providerID: model.providerID,
      family: model.family,
      name: model.name,
      capabilities: model.capabilities,
      variants: model.variants.map((variant) => ({ id: variant.id })),
      time: model.time,
      cost: model.cost,
      status: model.status,
      enabled: model.enabled,
      limit: model.limit,
    })),
    providers: catalog.providers.map((provider) => ({
      id: provider.id,
      integrationID: provider.integrationID,
      name: provider.name,
      disabled: provider.disabled,
      connected: provider.connected,
    })),
  }
}
