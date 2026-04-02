# APEX Agent Server Extension for Zed

A [Zed](https://zed.dev) extension that integrates [APEX](https://github.com/netbrah/apex) as an AI agent server using the [Agent Client Protocol (ACP)](https://agentclientprotocol.com).

## Features

- **Native Agent Experience**: Integrated AI assistant panel within Zed's interface
- **Agent Client Protocol**: Full support for ACP enabling advanced IDE interactions
- **File Management**: @-mention files to add them to the conversation context
- **Conversation History**: Access to past conversations within Zed
- **Multi-platform Support**: Works on macOS (ARM64 & Intel), Linux, and Windows

## Installation

1. Open Zed Editor
2. Open the Extensions panel (`cmd-shift-x` on macOS or `ctrl-shift-x` on Linux/Windows)
3. Search for "APEX"
4. Click "Install"
5. Switch to the **Agent Server** tab and ensure APEX is enabled

Alternatively, you can install from the command line:

```bash
zed --install-extension apex
```

## Usage

1. Open the Agent Panel in Zed (`cmd-shift-a` on macOS or `ctrl-shift-a` on Linux/Windows)
2. Select "APEX" from the agent list
3. Start chatting with the AI assistant

### Tips

- Use `@filename` to mention files in your conversation
- The agent can read, write, and edit files in your workspace
- Ask the agent to explain code, suggest improvements, or help with debugging
- Use natural language to describe what you want to accomplish

## Requirements

- Zed Editor (latest version recommended)
- Internet connection for AI model access
- Node.js >= 20 (for running APEX agent server)

## Configuration

### Environment Variables

When running as an agent server, APEX will:

- Inherit environment variables from Zed
- Read/create `~/.qwen` directory for runtime settings
- Use existing model and authentication settings in `~/.apex/settings.json` (except for initial login)

For additional environment variables, configure them in your Zed settings:

```json
{
  "agent_servers": {
    "apex": {
      "env": {
        "APEX_LOG_LEVEL": "info",
        "YOUR_CUSTOM_VAR": "value"
      }
    }
  }
}
```

## Troubleshooting

### Server shutdown unexpectedly

If you encounter errors like "server shut down unexpectedly" or similar issues:

1. Collect logs by pressing `cmd+shift+p` (macOS) or `ctrl+shift+p` (Linux/Windows)
2. Select **Zed: Open Log**
3. Check logs related to agent server or Node.js
4. Include the relevant log information when creating an issue

### Agent server starts but encounters issues

If the agent server starts successfully but you experience problems during use:

1. Press `cmd+shift+p` (macOS) or `ctrl+shift+p` (Linux/Windows)
2. Select **Dev: Open ACP Logs**
3. Review ACP logs for error messages
4. Include the relevant log information when creating an issue

### Where to report issues

You can report issues at either:

- [APEX Issues](https://github.com/netbrah/apex/issues)
- [APEX Zed Extension Issues](https://github.com/netbrah/apex-zed-extension/issues)

## Documentation

- [APEX Documentation](https://netbrah.github.io/apex-docs/)
- [Zed Agent Panel Guide](https://zed.dev/docs/ai/agent-panel)
- [Agent Client Protocol](https://agentclientprotocol.com)

## Support

- [Report Issues](https://github.com/netbrah/apex/issues)
- [APEX Discussions](https://github.com/netbrah/apex/discussions)
- [Zed Community](https://zed.dev/community)

## License

See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## About APEX

APEX is an AI-powered coding assistant that helps developers write better code faster. It provides intelligent code completion, refactoring suggestions, bug detection, and natural language code generation.

Learn more at [netbrah.github.io/apex-docs](https://netbrah.github.io/apex-docs/)

## Stay Tuned

The current version still requires Node.js to run. A single-file executable version is in development - stay tuned for updates!
