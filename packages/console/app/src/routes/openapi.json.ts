export async function GET() {
  const response = await fetch(
    "https://raw.githubusercontent.com/hena-agent/hena/refs/heads/develop/packages/sdk/openapi.json",
  )
  const json = await response.json()
  return json
}
