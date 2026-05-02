# obscura-mcp

An MCP server adapter for [Obscura](https://github.com/h4ckf0r0day/obscura), a lightweight Rust headless browser for scraping and AI agent automation.

Exposes Obscura's native CDP capabilities through a clean MCP interface — no Chrome dependency, no heavyweight browser automation.

## Installation

```bash
npm install -g obscura-mcp
```

The install is **instant** — the browser binary (~80 MB) is downloaded lazily on first use. When you run `obscura-mcp`, it will automatically download and cache the binary.

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

# Start MCP server
obscura-mcp --transport stdio

# Or with HTTP transport
obscura-mcp --transport streamable-http
```

## Tools — 12 total

### One-shot tools

Navigate, extract, click, and type — each call opens a page, performs the action, and closes. No session management needed.

| Tool | Description |
|------|-------------|
| `browse_url` | Fetch a URL and return content as `html`, `text`, or `links`. Supports cookie injection for authenticated pages. |
| `browse_evaluate` | Navigate to a URL and execute JavaScript. Returns the evaluated result. |
| `browse_cookies` | Navigate to a URL and retrieve all cookies set by the page. |
| `page_to_markdown` | Navigate to a URL and convert the page content to clean markdown. |
| `browse_click` | Click an element by CSS selector. Works one-shot (pass `url`) or within a session (pass `session_id`). |
| `browse_type` | Type text into an input by CSS selector. Works one-shot (pass `url`) or within a session (pass `session_id`). |

### Session tools

Create, manage, and interact with persistent browser sessions. Perfect for multi-step flows: login → wait for 2FA → navigate → extract data.

| Tool | Description |
|------|-------------|
| `session_create` | Create a persistent browsing session. Returns a session ID. Optionally navigate to a URL immediately. |
| `session_close` | Close a session and release its resources. Idempotent — safe to call multiple times. |
| `session_list` | List all active sessions with creation and last-used timestamps. |
| `browse_goto` | Navigate an existing session to a new URL. The page remains alive after navigation. |
| `browse_wait` | Wait for a condition — CSS selector to appear, or JavaScript expression to return true. Configurable timeout. |
| `browse_extract` | Execute JavaScript in a session and return the result. Read page state after navigation. |

### Session usage pattern

```
1. session_create(url?)      → session_xxx
2. browse_goto(session_id, url)  → navigate
3. browse_extract(session_id, expression) → read page state
   browse_click(session_id, selector) → interact
   browse_type(session_id, selector, text) → fill forms
4. browse_wait(session_id, selector/expression, timeout?) → wait for things to load
5. browse_extract(session_id, expression) → read new state
6. session_close(session_id) → cleanup
```

Sessions auto-close after 5 minutes of inactivity. Multiple sessions can run simultaneously.

### Examples

**One-shot: get page text**
```
browse_url(url: "https://example.com", dump: "text")
```

**One-shot: click a link**
```
browse_click(url: "https://example.com", selector: "a")
```

**Session: login flow**
```
session_create(url: "https://example.com/login")
browse_type(session_id, selector: "#username", text: "user")
browse_type(session_id, selector: "#password", text: "pass")
browse_click(session_id, selector: "#login-btn")
browse_wait(session_id, selector: ".dashboard")
browse_extract(session_id, expression: "document.title")
session_close(session_id)
```

**Session: browse multiple articles**
```
session_create()
browse_goto(session_id, url: "https://en.wikipedia.org/wiki/JavaScript")
browse_extract(session_id, expression: "document.title")
browse_goto(session_id, url: "https://en.wikipedia.org/wiki/Python")
browse_extract(session_id, expression: "document.title")
session_close(session_id)
```

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
|----------|---------|-------------|
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
