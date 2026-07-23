declare global {
  const HENA_AGENT_VERSION: string
  const HENA_AGENT_CHANNEL: string
}

export const InstallationVersion = typeof HENA_AGENT_VERSION === "string" ? HENA_AGENT_VERSION : "local"
export const InstallationChannel = typeof HENA_AGENT_CHANNEL === "string" ? HENA_AGENT_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
