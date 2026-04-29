# mcp-obscura

An MCP server adapter for [Obscura](https://github.com/h4ckf0r0day/obscura) — a lightweight, stealthy headless browser engine written in Rust.

This MCP server enables AI agents and LLMs to use Obscura for high-performance web scraping and automation through the Model Context Protocol.

## Features

- 🚀 **High-Performance**: 85ms page load, instant startup (vs 500ms+ for Chrome)
- 🎭 **Anti-Detection**: Built-in stealth mode for bypassing bot detection
- 💾 **Lightweight**: 30 MB memory footprint, 70 MB binary
- 🔌 **MCP Compatible**: Works with Claude, GPT, and other MCP-aware AI systems
- 📄 **Multiple Output Formats**: HTML, plain text, or links extraction

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

Add to your MCP configuration file (usually in VS Code Insiders at `~/.config/Code - Insiders/User/mcp.json`):

```json
{
  "servers": {
    "mcp-obscura": {
      "command": "node",
      "args": ["/path/to/mcp-obscura/index.js"],
      "env": {
        "OBSCURA_PATH": "/usr/local/bin/obscura"
      }
    }
  }
}
```

### Configuration Options

- `OBSCURA_PATH` - Path to the Obscura binary (default: `obscura` - assumes it's in PATH)

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

MIT © 2025 mino

**Note:** This project adapts [Obscura](https://github.com/h4ckf0r0day/obscura), which is licensed under Apache 2.0. This adapter is provided under MIT license for convenience and compatibility with MCP ecosystems.
