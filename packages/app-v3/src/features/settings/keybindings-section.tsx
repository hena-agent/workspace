const KEYBINDINGS = [
  { command: "Command palette", keys: "Mod+K" },
  { command: "New session", keys: "Mod+N" },
  { command: "Toggle sidebar", keys: "Mod+B" },
  { command: "Send message", keys: "Enter" },
  { command: "Queue message", keys: "Mod+Shift+Enter" },
] as const

export function KeybindingsSection() {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-2 font-medium">Command</th>
          <th className="py-2 font-medium">Shortcut</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {KEYBINDINGS.map((binding) => (
          <tr key={binding.command}>
            <td className="py-2">{binding.command}</td>
            <td className="py-2 font-mono text-xs text-muted-foreground">{binding.keys}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
