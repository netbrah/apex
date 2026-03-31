# Apex Companion

Seamlessly integrate Apex into Visual Studio Code with native IDE features and an intuitive chat interface. This extension bundles everything you need -- no additional installation required.

## Features

- **Native IDE experience**: Dedicated Apex Chat panel accessed via the Apex icon in the editor title bar
- **Native diffing**: Review, edit, and accept changes in VS Code's diff view
- **Auto-accept edits mode**: Automatically apply changes as they're made
- **File management**: @-mention files or attach files and images using the system file picker
- **Conversation history & multiple sessions**: Access past conversations and run multiple sessions simultaneously
- **Open file & selection context**: Share active files, cursor position, and selections for more precise help

## Requirements

- Visual Studio Code 1.85.0 or newer (also works with Cursor, Windsurf, and other VS Code-based editors)

## Quick Start

1. **Install** from a `.vsix` package or the extension marketplace

2. **Open the Chat panel** using one of these methods:
   - Click the **Apex icon** in the top-right corner of the editor
   - Run `Apex: Open` from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)

3. **Start chatting** -- Ask Apex to help with coding tasks, explain code, fix bugs, or write new features

## Commands

| Command                     | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `Apex: Open`                | Open the Apex Chat panel                               |
| `Apex: Run`                 | Launch a classic terminal session with the bundled CLI |
| `Apex: Accept Current Diff` | Accept the currently displayed diff                    |
| `Apex: Close Diff Editor`   | Close/reject the current diff                          |

## Author

Dinesh Palanisamy (palanisd@netapp.com)

## License

Apache-2.0
