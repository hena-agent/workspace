const theme = localStorage.getItem("theme")
const resolvedTheme =
  theme === "dark" || theme === "light"
    ? theme
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
const density = localStorage.getItem("density")
const fontSize = localStorage.getItem("font-size")
const reducedMotion = localStorage.getItem("reduced-motion")

document.documentElement.classList.add(resolvedTheme)
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#080808" : "#fafafa")
if (density === "compact" || density === "comfortable") document.documentElement.dataset.density = density
if (fontSize === "small" || fontSize === "medium" || fontSize === "large") {
  document.documentElement.dataset.fontSize = fontSize
}
if (reducedMotion === "true" || reducedMotion === "false") {
  document.documentElement.dataset.reducedMotion = reducedMotion
}
