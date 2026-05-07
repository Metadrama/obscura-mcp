---
name: obscura-mcp
description: Headless browser MCP server — lightweight Rust binary with built-in stealth, multi-session management, parallel scraping, and 7 output formats. No Chrome dependency.
version: 0.1.4-2
author: Metadrama
license: MIT
metadata:
  hermes:
    tags: [Browser, MCP, Web Scraping, Stealth, Headless, CDP, Rust]
    related_skills: [native-mcp, fastmcp]
    homepage: https://github.com/Metadrama/obscura-mcp
prerequisites:
  commands: [node, npm]
---

# obscura-mcp

[obscura-mcp](https://github.com/Metadrama/obscura-mcp) is an MCP server that wraps [Obscura](https://github.com/h4ckf0r0day/obscura), a lightweight Rust headless browser (~15 MB binary, no Chrome). It exposes Obscura's native CDP capabilities through a clean MCP interface with 4 tools — from one-shot page reads to parallel bulk scraping.

## When to Use

- **Parallel scraping** — need to scrape 10, 50, or 500 URLs in one shot. Hermes' built-in browser tools handle one page at a time; `browse_scrape` spawns isolated worker processes (30 MB each) and runs them concurrently.
- **No Chrome / constrained environments** — Obscura is pure Rust (~15 MB). No Chromium download (~200 MB+), no Chrome dependency. Great for VPS, containers, or low-disk setups.
- **Stealth without paying** — Hermes' stock `agent-browser` uses stock Chromium (easy to detect). Obscura has built-in anti-detection (stealth flag) without needing Camofox or Browserbase.
- **Custom output formats** — need accessibility trees (`axtree`), layout metrics (`layout`), or structured cookie dumps (`cookies`). Hermes' built-in snapshot gives you an axtree; obscura-mcp gives you 6 more formats.
- **Cookie-aware scraping** — inject, read, and clear cookies across sessions. Useful for flows that depend on session state.
- **When `web_extract` fails** — dynamic pages, JS-heavy SPAs, or sites that block plain HTTP fetchers. Obscura is a real browser (CDP-native).

## How It Differs from Hermes' Built-in Browser Tools

| Scenario | Hermes stock browser | obscura-mcp |
|----------|---------------------|-------------|
| One page, quick read | ✅ browser_navigate + snapshot | ✅ browse_page (7 formats) |
| Click, type, interact | ✅ browser_click, browser_type | ✅ browse_interact |
| Multi-step session | ✅ sequence of navigate/click/type | ✅ browse_session with goto/wait/extract |
| **Bulk parallel scrape** | ❌ manual scripting needed | ✅ browse_scrape (workers, concurrency) |
| **Stealth without Camofox** | ❌ needs Browserbase or Camofox | ✅ built-in stealth flag |
| **No Chrome install** | ❌ requires Chromium (200 MB+) | ✅ Rust binary (~15 MB) |
| **Custom HTTP headers** | ❌ | ✅ per-request |
| **User-agent override** | set globally only | ✅ per-request |
| **Cookie management** | ❌ | ✅ inject, read, clear |
| **Millisecond startup** | ❌ Chromium cold start ~2-5s | ✅ ~5 ms |

## Prerequisites

- Node.js 18+ and npm
- ~80 MB disk for the Obscura binary (downloaded lazily on first use)

## Installation

```bash
npm install -g obscura-mcp
```

The binary is downloaded automatically on first `obscura-mcp` run and cached at `~/.obscura/bin/` — no separate install step.

## Hermes Configuration

Add obscura-mcp as an MCP server in `~/.hermes/config.yaml`:

```yaml
mcp:
  servers:
    obscura-mcp:
      command: obscura-mcp
      args: ["--transport", "stdio"]
```

Then in any Hermes session, the tools are available as `obscura-mcp_*` prefixed tools. Verify:

```
# In chat or CLI
tools/list -> look for obscura-mcp tools in the list
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSCURA_PATH` | — | Path to custom Obscura binary |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP transport host |
| `MCP_HTTP_PORT` | `3000` | HTTP transport port |
| `OBSCURA_STARTUP_TIMEOUT_MS` | `15000` | CDP startup timeout |
| `OBSCURA_NAVIGATION_WAIT_MS` | `3000` | Post-navigation settle time |
| `CDP_REQUEST_TIMEOUT_MS` | `10000` | CDP command timeout |

## Tools

### `browse_page` — one-shot page reading

```json
{
  "url": "https://example.com",
  "format": "markdown",
  "eval": "document.title",
  "cookies": [{"name": "session", "value": "abc123"}],
  "user_agent": "MyBot/1.0",
  "headers": {"X-Custom": "value"}
}
```

| Format | Returns |
|--------|---------|
| `text` | Plain text, stripped of markup |
| `markdown` | Clean markdown via Obscura's LP.getMarkdown |
| `html` | Raw HTML |
| `links` | All href values, one per line |
| `cookies` | Cookie dump (name, value, domain, path, expiry) |
| `axtree` | Accessibility tree (roles + names + values) |
| `layout` | Viewport metrics (dimensions, scroll, scale) |

### `browse_interact` — click or type, one shot

```json
{
  "url": "https://example.com/login",
  "action": "type",
  "selector": "#username",
  "text": "user"
}
```

### `browse_session` — multi-step persistent sessions

```json
// Create
{"action": "create", "url": "https://example.com", "clear_cookies": true}

// Navigate
{"action": "goto", "session_id": "session_1", "url": "https://example.com/page2"}

// Interact
{"action": "type", "session_id": "session_1", "selector": "#search", "text": "query"}

// Wait and extract
{"action": "wait", "session_id": "session_1", "selector": ".results", "timeout": 10000}
{"action": "extract", "session_id": "session_1", "expression": "document.title"}

// Close
{"action": "close", "session_id": "session_1"}
```

Sessions auto-close after 5 minutes of inactivity.

### `browse_scrape` — parallel bulk scraping

```json
{
  "urls": ["https://example.com/a", "https://example.com/b"],
  "eval": "document.querySelector('h1')?.textContent",
  "concurrency": 25,
  "timeout": 60
}
```

Each URL gets an isolated Obscura worker process (~30 MB each). Results include timing, error reporting, and per-worker metadata.

## When NOT to Use

- If you already have Browserbase or Camofox configured and working — Hermes' built-in browser tools cover most interactive cases well
- For one-off page reads of static content — `web_extract` or `web_search` is cheaper and faster (no browser launch)
- If you don't need any of the features above (stealth, parallel scrape, custom formats) — stock tools are simpler

## Pitfalls

- **First run downloads the binary** — the first `obscura-mcp` invocation downloads ~80 MB. Subsequent runs are instant.
- **`browse_scrape` uses worker processes** — each URL spawns a separate `obscura-worker` process. At high concurrency (100+), ensure your system has enough file descriptors.
- **Sessions expire** — `browse_session` auto-closes after 5 minutes of inactivity. Long-running flows need the occasional `extract` or `goto` to keep the session alive.
- **Stealth is not infallible** — Obscura's built-in stealth works against common fingerprinting, but sites with aggressive bot detection (Cloudflare 5s challenge, hCaptcha) may still block. Pair with rotating proxies for production scraping.
- **No native Windows support** — Obscura officially supports Linux and macOS. Windows users can run via WSL2.
- **Port conflicts** — the Obscura CDP port (default 9222) may conflict with a local Chrome instance running with `--remote-debugging-port=9222`. Use `OBSCURA_STARTUP_TIMEOUT_MS` and ensure no other browser is using that port.

## See Also

- [native-mcp](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-native-mcp) — general MCP server setup in Hermes
- [agent-browser](https://www.npmjs.com/package/agent-browser) — Hermes' default local Chromium browser backend
- [Obscura](https://github.com/h4ckf0r0day/obscura) — upstream Rust headless browser
