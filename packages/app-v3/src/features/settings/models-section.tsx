import type { Model, Provider } from "@/lib/types"

export function ModelsSection({ models, providers }: { models: Model[]; providers: Provider[] }) {
  return (
    <div className="flex flex-col gap-4">
      {providers.map((provider) => {
        const providerModels = models.filter((model) => model.providerId === provider.id)
        if (providerModels.length === 0) return null

        return (
          <div key={provider.id}>
            <h3 className="text-xs font-medium text-muted-foreground">{provider.name}</h3>
            <div className="mt-1 divide-y">
              {providerModels.map((model) => (
                <div key={model.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{model.name}</span>
                  <span className="text-xs text-muted-foreground">{model.contextWindow.toLocaleString()} tokens</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
