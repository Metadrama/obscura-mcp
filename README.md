# mcp-obscura

An MCP server adapter for [Obscura](https://github.com/h4ckf0r0day/obscura) — a lightweight, stealthy headless browser engine written in Rust.

This MCP server enables AI agents and LLMs to use Obscura for high-performance web scraping and automation through the Model Context Protocol.

## Features

- 🚀 **High-Performance**: 85ms page load, instant startup (vs 500ms+ for Chrome)
- 🎭 **Anti-Detection**: Built-in stealth mode for bypassing bot detection
- 💾 **Lightweight**: 30 MB memory footprint, 70 MB binary
- 🔌 **MCP Compatible**: Works with Claude, GPT, and other MCP-aware AI systems
- 📄 **Multiple Output Formats**: HTML, plain text, or links extraction
- 🔀 **Dual Transport**: `stdio` (default) and streamable HTTP

## Prerequisites

1. **Node.js** 16+
2. **Obscura Binary** - Download from [Obscura releases](https://github.com/h4ckf0r0day/obscura/releases)

### Install Obscura

```bash
# Linux x86_64
curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-linux.tar.gz
tar xzf obscura-x86_64-linux.tar.gz
sudo mv obscura /usr/local/bin/

# macOS Apple Silicon
curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-aarch64-macos.tar.gz
tar xzf obscura-aarch64-macos.tar.gz
sudo mv obscura /usr/local/bin/

# macOS Intel
curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-macos.tar.gz
tar xzf obscura-x86_64-macos.tar.gz
sudo mv obscura /usr/local/bin/

# Windows
# Download from releases, extract, and add to PATH
```

## Installation

```bash
npm install mcp-obscura
```

## Configuration

This server can run in two modes:

- `stdio` (default): best baseline for local clients
- `http`: streamable HTTP endpoint for remote/team scenarios

### VS Code (Stable or Insiders)

Add to your MCP configuration file:

- Workspace: `.vscode/mcp.json`
- User profile (Stable): `%APPDATA%/Code/User/mcp.json` on Windows
- User profile (Insiders): `%APPDATA%/Code - Insiders/User/mcp.json` on Windows

```json
{
  "servers": {
    "mcp-obscura": {
      "command": "node",
      "args": ["/path/to/mcp-obscura/index.js"],
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
    "mcp-obscura": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-obscura/index.js"],
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
    "mcp-obscura": {
      "command": "node",
      "args": ["/path/to/mcp-obscura/index.js"],
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
    "mcp-obscura": {
      "command": "node",
      "args": ["/path/to/mcp-obscura/index.js"],
      "env": {
        "OBSCURA_PATH": "/usr/local/bin/obscura",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

### Configuration Options

- `OBSCURA_PATH` - Path to the Obscura binary (default: `obscura` - assumes it's in PATH)
- `MCP_TRANSPORT` - `stdio` or `http` (default: `stdio`)
- `MCP_HTTP_HOST` - HTTP bind host (default: `127.0.0.1`)
- `MCP_HTTP_PORT` - HTTP bind port (default: `3000`)
- `MCP_HTTP_PATH` - HTTP endpoint path (default: `/mcp`)
- `OBSCURA_TIMEOUT_MS` - Obscura execution timeout in ms (default: `30000`)
- `MAX_BODY_BYTES` - Maximum HTTP request body size in bytes (default: `1048576`)

## Usage

Once configured, the MCP server provides the `browse_url` tool:

```
Tool: browse_url
Description: Fetch a URL using Obscura's native high-performance engine

Parameters:
  - url (required): The URL to visit
  - dump (optional): Output format - "html" | "text" | "links" (default: "html")
  - stealth (optional): Enable stealth mode (default: true)
```

### Examples

**Get page title:**
```
browse_url(url: "https://example.com", dump: "text")
```

**Extract all links:**
```
browse_url(url: "https://example.com", dump: "links")
```

**Render JavaScript and get full HTML:**
```
browse_url(url: "https://news.ycombinator.com", dump: "html")
```

## Development

### Project Structure

```
mcp-obscura/
├── index.js          # Main MCP server implementation
├── package.json      # Node dependencies
├── LICENSE           # MIT License
└── README.md         # This file
```

### Building from Source

```bash
npm install
node index.js
```

Run explicit transport modes:

```bash
npm run start:stdio
npm run start:http
```

### Testing

```bash
npm test
```

## Architecture

The MCP server wraps Obscura's CLI interface:

1. Receives MCP tool requests via stdio
2. Translates them to Obscura CLI commands
3. Executes Obscura binary with appropriate flags
4. Returns results back through MCP protocol

In HTTP mode, requests are served through a streamable MCP endpoint at `http://<host>:<port><path>`.

## Performance Comparison

| Metric | Obscura | Headless Chrome |
|--------|---------|-----------------|
| Memory | 30 MB | 200+ MB |
| Binary Size | 70 MB | 300+ MB |
| Page Load | 85 ms | ~500 ms |
| Startup | Instant | ~2s |

## Limitations

- Obscura binary must be separately installed and available in PATH or `OBSCURA_PATH`
- Stealth mode requires Obscura compiled with `--features stealth`
- Limited to Obscura's CLI capabilities (no direct V8 access through this adapter)

## Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

## Related Projects

- [Obscura](https://github.com/h4ckf0r0day/obscura) - The underlying headless browser engine
- [MCP](https://modelcontextprotocol.io) - Model Context Protocol specification

## License

MIT © 2026 Metadrama

**Note:** This project adapts [Obscura](https://github.com/h4ckf0r0day/obscura), which is licensed under Apache 2.0. This adapter is provided under MIT license for convenience and compatibility with MCP ecosystems.
