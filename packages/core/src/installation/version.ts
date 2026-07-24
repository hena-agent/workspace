declare global {
  const HENA_VERSION: string
  const HENA_CHANNEL: string
}

export const InstallationVersion = typeof HENA_VERSION === "string" ? HENA_VERSION : "local"
export const InstallationChannel = typeof HENA_CHANNEL === "string" ? HENA_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
