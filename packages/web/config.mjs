const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://hena.dev" : `https://${stage}.hena.dev`,
  console: stage === "production" ? "https://hena.dev/auth" : `https://${stage}.hena.dev/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/hena-agent/hena",
  discord: "https://hena.dev/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
