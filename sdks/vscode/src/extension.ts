// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"

const TERMINAL_NAME = "Hena"

export function activate(context: vscode.ExtensionContext) {
  const openTerminalDisposable = vscode.commands.registerCommand("hena.openTerminal", async () => {
    // A Hena terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  context.subscriptions.push(openTerminalDisposable)

  async function openTerminal() {
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        HENA_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText("hena web")
  }
}
