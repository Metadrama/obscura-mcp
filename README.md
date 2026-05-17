# obscura-mcp — ARCHIVED

> **⚠️ This project is archived.**
>
> As of [Obscura v0.1.4](https://github.com/h4ckf0r0day/obscura/releases/tag/v0.1.4), the upstream project ships its own MCP server via `obscura mcp` with 12 browser tools over stdio and HTTP. This npm wrapper is no longer needed.
>
> obscura-mcp was built as a Node.js bridge before upstream MCP existed — it auto-downloaded the Obscura binary and exposed it through the Model Context Protocol. Upstream caught up quickly, which is a good sign for the project.
>
> The npm package (`obscura-mcp`) has been deprecated with a notice pointing to the official MCP server.

[![npm version](https://img.shields.io/npm/v/obscura-mcp)](https://www.npmjs.com/package/obscura-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

An MCP server adapter for [Obscura](https://github.com/h4ckf0r0day/obscura), a lightweight Rust headless browser for scraping and AI agent automation.

Exposes Obscura's native CDP capabilities through a clean MCP interface — no Chrome dependency, no heavyweight browser automation.

## Installation

```bash
npm install -g obscura-mcp
```

The npm package itself is a small Node.js wrapper (~20 KB). The browser binary (~80 MB) is downloaded automatically on first use — no separate install step needed.

The binary is cached at `~/.obscura/bin/` and survives npm upgrades.

**Pre-release builds** are published under the `dev` tag:

```bash
npm install -g obscura-mcp@dev
```

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

# Start MCP server (stdio — primary transport)
obscura-mcp --transport stdio

# Or with HTTP transport
obscura-mcp --transport streamable-http
```

Most MCP clients (Claude Desktop, Cline, Continue) connect via `stdio`. The `streamable-http` transport is also supported for custom integrations.

## Tools

Four tools cover browsing, interacting, session persistence, and bulk scraping.

### `browse_page` — one-shot page reading

Get content from any page in a single call. Combine output format with optional JavaScript evaluation.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | — | The URL to visit |
| `format` | `"text"` \| `"markdown"` \| `"html"` \| `"links"` \| `"cookies"` \| `"axtree"` \| `"layout"` | `"text"` | Output format |
| `eval` | `string` | — | JavaScript expression to evaluate (appended to output) |
| `cookies` | `array` | — | Cookies to inject `[{name, value, domain?, path?, ...}]` |
| `user_agent` | `string` | — | Override the browser user-agent string |
| `headers` | `object` | — | Extra HTTP headers `{key: value, ...}` |
| `stealth` | `boolean` | `true` | Accepted for compatibility; stealth is controlled by the Obscura server |

**Examples:**

```
browse_page(url: "https://example.com")
browse_page(url: "https://example.com", format: "markdown")
browse_page(url: "https://example.com", format: "axtree")
browse_page(url: "https://example.com", format: "layout")
browse_page(url: "https://example.com", user_agent: "TestBot/1.0")
```

| `format` | What you get |
|----------|-------------|
| `"text"` | Plain text — stripped of HTML tags, scripts, styles |
| `"markdown"` | Clean markdown — uses Obscura's native LP.getMarkdown CDP |
| `"html"` | Raw HTML markup |
| `"links"` | All href values — one per line |
| `"cookies"` | Cookies with name, value, domain, path, expiry |
| `"axtree"` | Accessibility tree — roles, names, values of all elements |
| `"layout"` | Viewport metrics — dimensions, scroll offsets, device scale |

When `eval` is provided, the JavaScript result is appended to the format output under a `--- eval ---` divider.

---

### `browse_interact` — one-shot page actions

Click an element or type text into a page. For multi-step interactions (login → wait → extract), use `browse_session` instead.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | — | The URL to visit |
| `action` | `"click"` \| `"type"` | — | Action to perform |
| `selector` | `string` | — | CSS selector for the target element |
| `text` | `string` | — | Text to type (required when `action` is `"type"`) |
| `cookies` | `array` | — | Cookies to inject `[{name, value, ...}]` |
| `stealth` | `boolean` | `true` | Accepted for compatibility; stealth is controlled by the Obscura server |

**Examples:**

```
browse_interact(url: "https://example.com", action: "click", selector: "a")
browse_interact(url: "https://duckduckgo.com", action: "type", selector: "input[name=q]", text: "search query")
```

Both actions create a fresh page, perform the action, and close. The page context does not persist — for sequential interactions (type into a form, then click submit), use `browse_session` instead.

---

### `browse_session` — multi-step persistent sessions

Create a persistent browser session, interact with it across multiple calls, then close. Sessions auto-close after 5 minutes of inactivity. Multiple sessions can run simultaneously.

| Parameter | Type | Required for | Description |
|-----------|------|-------------|-------------|
| `action` | `"create"` \| `"close"` \| `"list"` \| `"goto"` \| `"wait"` \| `"extract"` \| `"click"` \| `"type"` | All | What to do |
| `session_id` | `string` | All except `create`, `list` | Session ID from `create` |
| `url` | `string` | `create`, `goto` | URL to navigate to |
| `selector` | `string` | `wait`, `click`, `type` | CSS selector |
| `expression` | `string` | `wait` (if no selector), `extract` | JavaScript expression |
| `text` | `string` | `type` | Text to type |
| `timeout` | `number` | `wait` (optional) | Max wait in ms (default 30000, max 120000) |
| `user_agent` | `string` | `create`, `goto` | Override user-agent string for navigation |
| `headers` | `object` | `create`, `goto` | Extra HTTP headers `{key: value, ...}` |
| `clear_cookies` | `boolean` | `create` | Clear all browser cookies on session creation |

**Session lifecycle:**

| `action` | What it does | Returns |
|----------|-------------|---------|
| `create` | Opens a new browser tab. Optionally clears cookies. | Session ID |
| `close` | Releases the tab and all its resources. Idempotent. | Confirmation |
| `list` | Shows all active sessions with timestamps. | Session list |
| `goto` | Navigates to a new URL. Page stays alive. | Confirmation |
| `wait` | Polls until a CSS selector exists or a JS expression returns true. | Confirmation |
| `extract` | Evaluates JavaScript and returns the result. | Eval result |
| `click` | Clicks an element by CSS selector. | Coordinates |
| `type` | Types text into an input field. | Confirmation |

**Login flow example:**

```
browse_session(action: "create", url: "https://example.com/login")
  → "Created session: session_1"

browse_session(action: "type", session_id: "session_1", selector: "#username", text: "user")
browse_session(action: "type", session_id: "session_1", selector: "#password", text: "pass")
browse_session(action: "click", session_id: "session_1", selector: "#login-btn")

browse_session(action: "wait", session_id: "session_1", selector: ".dashboard", timeout: 10000)
browse_session(action: "extract", session_id: "session_1", expression: "document.title")

browse_session(action: "close", session_id: "session_1")
```

**Multi-article browsing example:**

```
browse_session(action: "create")
browse_session(action: "goto", session_id: "session_1", url: "https://en.wikipedia.org/wiki/JavaScript")
browse_session(action: "extract", session_id: "session_1", expression: "document.title")
browse_session(action: "goto", session_id: "session_1", url: "https://en.wikipedia.org/wiki/Python")
browse_session(action: "extract", session_id: "session_1", expression: "document.title")
browse_session(action: "close", session_id: "session_1")
```

---

### `browse_scrape` — parallel bulk scraping

Scrape multiple URLs simultaneously using isolated worker processes. Each URL gets its own headless browser worker — built on top of Obscura's native `scrape` command with `obscura-worker`.

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `urls` | `string[]` | — | 1000 | URLs to scrape in parallel |
| `eval` | `string` | — | — | JavaScript expression to evaluate per page |
| `concurrency` | `number` | `10` | `100` | Number of parallel worker processes |
| `timeout` | `number` | `60` | `300` | Per-worker timeout in seconds |

**Example:**

```
browse_scrape(urls: ["https://news.ycombinator.com", "https://example.com"], eval: "document.title", concurrency: 25)
```

**Output format (JSON):**

```json
{
  "total_urls": 2,
  "concurrency": 25,
  "total_time_ms": 1250,
  "avg_time_ms": 625.0,
  "results": [
    {
      "url": "https://news.ycombinator.com",
      "title": "Hacker News",
      "eval": "Hacker News",
      "time_ms": 612,
      "worker": 0
    },
    {
      "url": "https://example.com",
      "eval": "Example Domain",
      "time_ms": 638,
      "worker": 1
    }
  ]
}
```

On errors (timeout, network failure, etc.), the per-URL result includes an `"error"` field instead of `"eval"`:

```json
{
  "url": "https://slow-site.com",
  "error": "timeout",
  "time_ms": 60000
}
```

This is the tool that directly leverages Obscura's core advantage over headless Chrome: lightweight parallel scraping with built-in stealth. The ~30 MB per-worker memory footprint means 100 concurrent workers use less memory than a single Chrome instance.

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
| `OBSCURA_STEALTH` | — | Enable stealth mode (anti-detection) |
| `OBSCURA_PROXY` | — | Proxy URL for all traffic |
| `OBSCURA_USER_AGENT` | — | Default user-agent override |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP transport host |
| `MCP_HTTP_PORT` | `3000` | HTTP transport port |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `streamable-http` |
| `OBSCURA_STARTUP_TIMEOUT_MS` | `15000` | Milliseconds to wait for Obscura CDP to start |
| `OBSCURA_NAVIGATION_WAIT_MS` | `3000` | Milliseconds to wait after page navigation |
| `CDP_REQUEST_TIMEOUT_MS` | `10000` | Milliseconds to wait for CDP response |

## Development

Built with TypeScript, compiled to `dist/`, tested with Vitest.

```bash
git clone https://github.com/Metadrama/obscura-mcp
cd obscura-mcp
npm install
npm run build
npm test
```

All 36 integration tests run against a real Obscura binary (auto-downloaded on first run). Tests use `StdioClientTransport` and cover every tool, format, and action.

## Why Obscura?

- **No Chrome** — pure Rust, no 200 MB browser bundle
- **CDP-native** — exposes Chrome DevTools Protocol directly
- **Anti-detection** — built-in stealth for scraping-resistant sites
- **Tiny footprint** — ~15 MB binary, starts in milliseconds

## License

MIT
