const PortOffset = 10_000
const MaxAppPort = 65_535 - PortOffset

export function portlessAppPort(port = process.env.PORT, portlessURL = process.env.PORTLESS_URL) {
  const value = Number(port)
  return portlessURL && Number.isInteger(value) && value > 0 && value <= MaxAppPort ? value : undefined
}

export function portlessServerPort(port = process.env.PORT, portlessURL = process.env.PORTLESS_URL) {
  const app = portlessAppPort(port, portlessURL)
  return app === undefined ? undefined : app + PortOffset
}

export function portlessOrigins(urls = [process.env.PORTLESS_URL, process.env.PORTLESS_TAILSCALE_URL]) {
  return urls.filter((url): url is string => url !== undefined && URL.canParse(url)).map((url) => new URL(url).origin)
}
