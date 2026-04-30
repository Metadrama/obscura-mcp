# obscura-mcp

An MCP adapter for the Obscura web browsing tool.

## Why This Exists

The original [obscura](https://github.com/h4ckf0r0day/obscura) engine is a powerful, lightweight, and stealthy headless browser designed for AI agents. However, it lacks a native Model Context Protocol (MCP) server.

This project bridges that gap. It's a simple adapter that exposes Obscura's capabilities through an MCP server, allowing it to be used directly by MCP-native clients like Claude Code, Cursor, and VS Code.

## Prerequisites

- **Node.js** (16.x or higher)

## Installation

This package installs an `obscura` browser binary during `postinstall` when possible.

```bash
# Install the adapter and let the browser engine bootstrap during postinstall
npm install -g obscura-mcp
```

### Verification

After installation, verify the server starts by running:
```bash
npm start
```
If you already have an Obscura binary installed elsewhere, point the server at it with `OBSCURA_PATH`.

## Configuration

Point your MCP client configuration to the installed server command or the local `index.js` file. Update the server name and path according to your setup.
The server resolves Obscura in this order: `OBSCURA_PATH`, `./bin/obscura(.exe)`, then `obscura` on `PATH`.

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
- `stealth` (boolean, optional): Accepted for compatibility, but currently ignored by the adapter.



## Related Projects

- [obscura](https://github.com/h4ckf0r0day/obscura): The underlying headless browser engine.
- [Model Context Protocol](https://modelcontextprotocol.io): The protocol specification.

## License

MIT
