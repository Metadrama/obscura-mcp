# obscura-mcp

An MCP server adapter for [Obscura](https://github.com/h4ckf0r0day/obscura), a lightweight Rust headless browser for scraping and AI agent automation.

Exposes Obscura's native CDP capabilities through a clean MCP interface — no Chrome dependency, no heavyweight browser automation.

## Installation

```bash
npm install -g obscura-mcp
```

The install is **instant** — the browser binary (~80 MB) is downloaded lazily on first use.

After install, either:
- Run `obscura-mcp install` to download the binary with visible progress, or
- Just run `obscura-mcp` — it downloads the binary automatically and starts the server

The binary is cached at `~/.obscura/bin/` and survives npm upgrades.

To use a custom binary path:
```bash
export OBSCURA_PATH=/path/to/obscura
```

## Quick Start

```bash
# Install
npm install -g obscura-mcp

# Verify
obscura-mcp --version

# Download browser binary
obscura-mcp install

# Start MCP server
obscura-mcp --transport stdio
```

## Tools

### `browse_url`
Fetch a URL using Obscura's CDP engine. Returns the page content.

**Parameters:**
- `url` (string, required): HTTP or HTTPS URL to visit.
- `dump` (string, optional): `html`, `text`, or `links`. Defaults to `html`.
- `cookies` (array, optional): Cookies to inject before navigation. Accepts the same format as returned by `browse_cookies` — pass cookies exported from a real browser to access authenticated pages.
- `stealth` (boolean, optional): Accepted for compatibility. Stealth behavior is controlled by the Obscura server.

### `browse_evaluate`
Navigate to a URL and execute JavaScript in the page context. Returns the evaluated result.

**Parameters:**
- `url` (string, required): The URL to visit.
- `expression` (string, required): JavaScript expression to evaluate. Examples: `document.title`, `navigator.userAgent`, `document.querySelector('h1').textContent`.
- `stealth` (boolean, optional): Accepted for compatibility.

### `browse_cookies`
Navigate to a URL and retrieve all cookies set by the page. Returns name, value, domain, path, and expiry for each cookie.

**Parameters:**
- `url` (string, required): The URL to visit.
- `stealth` (boolean, optional): Accepted for compatibility.

## Configuration

### Claude Desktop / Cline / Continue / Any MCP client

```json
{
  "mcpServers": {
    "obscura-mcp": {
      "command": "obscura-mcp",
      "args": ["--transport", "stdio"]
    }
  }
}
```

### VS Code (Cline extension)

```json
{
  "servers": {
    "obscura-mcp": {
      "command": "obscura-mcp",
      "args": ["--transport", "stdio"]
    }
  }
}
```

After global npm install, `obscura-mcp` is on your PATH — no absolute paths needed.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OBSCURA_PATH` | — | Path to custom Obscura binary |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP transport host |
| `MCP_HTTP_PORT` | `3000` | HTTP transport port |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `streamable-http` |
| `OBSCURA_STARTUP_TIMEOUT_MS` | `15000` | Milliseconds to wait for Obscura CDP to start |
| `OBSCURA_NAVIGATION_WAIT_MS` | `3000` | Milliseconds to wait after page navigation |
| `CDP_REQUEST_TIMEOUT_MS` | `10000` | Milliseconds to wait for CDP response |

## Why Obscura?

- **No Chrome** — pure Rust, no 200 MB browser bundle
- **CDP-native** — exposes Chrome DevTools Protocol directly
- **Anti-detection** — built-in stealth for scraping-resistant sites
- **Tiny footprint** — ~15 MB binary, starts in milliseconds

## License

MIT
