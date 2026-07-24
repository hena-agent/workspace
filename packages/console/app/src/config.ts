/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://hena.dev",

  // GitHub
  github: {
    repoUrl: "https://github.com/hena-agent/hena",
    starsFormatted: {
      compact: "160K",
      full: "160,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/hena",
    discord: "https://discord.gg/hena",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "900",
    commits: "13,000",
    monthlyUsers: "7.5M",
  },
} as const
