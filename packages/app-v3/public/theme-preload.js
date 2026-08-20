const theme = localStorage.getItem("theme")
document.documentElement.classList.add(
  theme === "dark" || theme === "light"
    ? theme
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
)
