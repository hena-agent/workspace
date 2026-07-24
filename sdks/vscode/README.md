# Hena VS Code Extension

A Visual Studio Code extension that integrates [Hena](https://hena.dev) directly into your development workflow.

## Prerequisites

This extension requires the [Hena CLI](https://hena.dev) to be installed on your system.

## Features

- **Quick Launch**: Use `Cmd+Esc` (Mac) or `Ctrl+Esc` (Windows/Linux) to open Hena in a split terminal view.
- **New Session**: Use `Cmd+Shift+Esc` (Mac) or `Ctrl+Shift+Esc` (Windows/Linux) to start a new Hena terminal session.
- **Context Awareness**: Automatically share your current selection or tab with Hena.
- **File Reference Shortcuts**: Use `Cmd+Option+K` (Mac) or `Alt+Ctrl+K` (Linux/Windows) to insert file references. For example, `@File#L37-42`.

## Support

This is an early release. Report issues at https://github.com/hena-agent/hena/issues.

## Development

1. `code sdks/vscode` - Open the `sdks/vscode` directory in VS Code. **Do not open from repo root.**
2. `bun install` - Run inside the `sdks/vscode` directory.
3. Press `F5` to start debugging - This launches a new VS Code window with the extension loaded.

#### Making Changes

`tsc` and `esbuild` watchers run automatically during debugging (visible in the Terminal tab). Changes to the extension are automatically rebuilt in the background.

To test your changes:

1. In the debug VS Code window, press `Cmd+Shift+P`
2. Search for `Developer: Reload Window`
3. Reload to see your changes without restarting the debug session
