# obscura-mcp

An MCP adapter for the Obscura web browsing tool.

## Why This Exists

The original [obscura](https://github.com/h4ckf0r0day/obscura) engine is a powerful, lightweight, and stealthy headless browser designed for AI agents. However, it lacks a native Model Context Protocol (MCP) server.

This project bridges that gap. It's a simple adapter that exposes Obscura's capabilities through an MCP server, allowing it to be used directly by MCP-native clients like Claude Code, Cursor, and VS Code.

## Prerequisites

- **Node.js** (16.x or higher)
- **Obscura CLI**: You must have the `obscura` binary installed and available in your system's PATH. You can download the latest release from the [official repository](https://github.com/h4ckf0r0day/obscura/releases).

## Installation

```bash
npm install -g @0bscura/mcp-server
```
Alternatively, you can clone this repository and run it locally:
```bash
git clone https://github.com/Metadrama/0bscura-mcp.git
cd 0bscura-mcp
npm install
```

## Configuration

Point your MCP client configuration to the installed server command or the local `index.js` file. Update the server name and path according to your setup.

### VS Code (Stable or Insiders)

Add to `.vscode/mcp.json` or your user-level MCP settings:

```json
{
  "servers": {
    "obscura-mcp": {
      "command": "node",
      "args": ["/path/to/obscura-mcp/index.js"],
      "env": {
        "OBSCURA_PATH": "/usr/local/bin/obscura",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

### Claude Code (project-scoped `.mcp.json`)

```json
{
  "mcpServers": {
    "obscura-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/obscura-mcp/index.js"],
      "env": {
        "OBSCURA_PATH": "/usr/local/bin/obscura",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "obscura-mcp": {
      "command": "node",
      "args": ["/path/to/obscura-mcp/index.js"],
      "env": {
        "OBSCURA_PATH": "/usr/local/bin/obscura",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

### Zed (`~/.config/zed/settings.json`)

```json
{
  "context_servers": {
    "obscura-mcp": {
      "command": "node",
      "args": ["/path/to/obscura-mcp/index.js"],
      "env": {
        "OBSCURA_PATH": "/usr/local/bin/obscura",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

## Tool Reference: `browse_url`

Fetches a URL using the Obscura engine.

**Parameters:**
- `url` (string, required): The URL to visit.
- `dump` (string, optional): The output format. Can be "html", "text", or "links". Defaults to "html".
- `stealth` (boolean, optional): Enables Obscura's stealth mode to bypass bot detection. Defaults to `true`.

## Architecture

This adapter uses a robust, high-performance architecture. On startup, it launches the `obscura serve` command as a background process and maintains a persistent connection to its Chrome DevTools Protocol (CDP) WebSocket endpoint.

This stateful approach provides the lowest possible latency for browsing operations, as the browser process is always running and ready to accept commands. All communication happens over the CDP connection, managed by `puppeteer-core`.

## Limitations

- The `obscura` binary must be installed separately.

## Related Projects

- [obscura](https://github.com/h4ckf0r0day/obscura): The underlying headless browser engine.
- [Model Context Protocol](https://modelcontextprotocol.io): The protocol specification.

## License

MIT
