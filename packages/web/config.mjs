const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://hena.ai" : `https://${stage}.hena.ai`,
  console: stage === "production" ? "https://hena.ai/auth" : `https://${stage}.hena.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/hena-agent/hena",
  discord: "https://hena.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
