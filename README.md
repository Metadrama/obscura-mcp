# obscura-mcp

An MCP server adapter for [Obscura](https://github.com/h4ckf0r0day/obscura), the lightweight Rust headless browser for scraping and AI agent automation.

This package starts an Obscura CDP server and exposes a small, MCP-native tool surface. It intentionally uses Obscura's native protocol capabilities rather than bundling Chrome or falling back to heavyweight browser automation.

## Prerequisites

- Node.js 18 or newer

## Installation

```bash
npm install -g mcp-obscura
```

The package downloads the pinned Obscura browser binary during `postinstall`. If you already have an Obscura binary, set `OBSCURA_PATH` in your MCP client configuration.

## Verification

From this repository:

```bash
npm install --cache .npm-cache
node test-mcp.js
```

After global install:

```bash
obscura --help
obscura-mcp --transport stdio
```

`obscura-mcp --transport stdio` is a long-running MCP server process. Stop it with Ctrl+C after confirming it starts.

## Codex Configuration

Add this to `~/.codex/config.toml`, adjusting paths for your installation:

```toml
[mcp_servers.obscura-mcp]
command = "node"
args = ["C:\\Users\\mino\\tools\\mcp-obscura\\index.js", "--transport", "stdio"]
env = { OBSCURA_PATH = "C:\\Users\\mino\\tools\\mcp-obscura\\bin\\obscura.exe", MCP_TRANSPORT = "stdio" }
```

For a global npm install, point `args` at the installed `index.js` or use the generated `obscura-mcp` command if your MCP client supports PATH lookup.

## Other MCP Clients

### VS Code

```json
{
  "servers": {
    "obscura-mcp": {
      "command": "node",
      "args": ["/path/to/mcp-obscura/index.js", "--transport", "stdio"],
      "env": {
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

### Claude Code or Cursor

```json
{
  "mcpServers": {
    "obscura-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-obscura/index.js", "--transport", "stdio"],
      "env": {
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

## Tools

### `browse_url`

Fetches a URL using Obscura's lightweight CDP server.

Parameters:

- `url` (string, required): HTTP or HTTPS URL to visit.
- `dump` (string, optional): `html`, `text`, or `links`. Defaults to `html`.
- `stealth` (boolean, optional): Accepted for compatibility. Stealth behavior is controlled by the Obscura server binary.

## Obscura Compatibility

This adapter targets Obscura's implemented CDP subset. It does not assume every Puppeteer or Chrome DevTools Protocol method exists. Unsupported CDP features should fail clearly through MCP rather than hanging startup or silently returning empty output.

## License

MIT
