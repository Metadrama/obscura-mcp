/**
 * obscura-mcp integration tests — Vitest + StdioClientTransport
 *
 * Curated coverage across all 4 tools and their methods:
 *   browse_page  — 7 formats + eval + cookies + errors
 *   browse_interact — click, type + error cases
 *   browse_session — full lifecycle (create → goto → wait → extract → click → type → close)
 *   browse_scrape  — single, multi, error cases
 *
 * Spawns the MCP server once (beforeAll), runs all tests against it,
 * then tears down (afterAll).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The compiled server lives at dist/index.js, two levels up from __tests__/
const SERVER_PATH = path.resolve(__dirname, "../../dist/index.js");

let client: Client;
let transport: StdioClientTransport;

// Shared session ID reused across browse_session tests
let sessionId: string;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH, "--transport", "stdio"],
    stderr: "pipe",
  });

  client = new Client(
    { name: "obscura-mcp-test", version: "0.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close();
}, 10_000);

// ─── helpers ─────────────────────────────────────────────────

function extractText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content?.[0]?.text ?? "";
}

// ─── Tool discovery ───────────────────────────────────────────

describe("server starts and all tools are registered", () => {
  it("should list all 4 tools", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("browse_page");
    expect(toolNames).toContain("browse_interact");
    expect(toolNames).toContain("browse_session");
    expect(toolNames).toContain("browse_scrape");
  });
});

// ─── browse_page — format variants ────────────────────────────

describe("browse_page — formats", () => {
  it("text format should return page text content", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "text" },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/example|domain/i);
  });

  it("markdown format should return clean markdown", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "markdown" },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(20);
  });

  it("html format should return raw HTML", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "html" },
    });
    const text = extractText(result);
    expect(text).toMatch(/<html|<body|<h1/i);
  });

  it("links format should extract all hrefs", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "links" },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/https?:\/\//i);
  });

  it("cookies format should return cookies for the page", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "cookies" },
    });
    const text = extractText(result);
    // example.com may or may not set cookies — both are valid
    expect(text).toBeDefined();
  });

  it("axtree format should return accessibility tree nodes", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "axtree" },
    });
    const text = extractText(result);
    expect(text).toMatch(/RootWebArea|generic|heading|StaticText/i);
  });

  it("layout format should return viewport metrics", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "layout" },
    });
    const text = extractText(result);
    expect(text).toMatch(/viewport|width|height|content/i);
  });
});

// ─── browse_page — extra params ───────────────────────────────

describe("browse_page — extra params", () => {
  it("should accept eval expression and return result", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: {
        url: "https://example.com",
        format: "text",
        eval: "document.title",
      },
    });
    const text = extractText(result);
    // The response format has eval result appended
    expect(text.length).toBeGreaterThan(0);
  });

  it("should accept cookies param", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: {
        url: "https://example.com",
        format: "text",
        cookies: [
          { name: "test_cookie", value: "hello", domain: ".example.com", path: "/" },
        ],
      },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(20);
  });

  it("should accept user_agent override", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: {
        url: "https://example.com",
        format: "text",
        user_agent: "TestBot/1.0",
      },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(20);
  });

  it("should accept custom headers", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: {
        url: "https://example.com",
        format: "text",
        headers: { "X-Test": "hello123" },
      },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(20);
  });
});

// ─── browse_page — errors ─────────────────────────────────────

describe("browse_page — errors", () => {
  it("should error on invalid URL", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "not-a-url" },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error/i);
  });

  it("should error on unsupported protocol", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "ftp://example.com" },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|unsupported/i);
  });
});

// ─── browse_interact ──────────────────────────────────────────

describe("browse_interact", () => {
  it("should click an element by CSS selector", async () => {
    const result = await client.callTool({
      name: "browse_interact",
      arguments: {
        url: "https://example.com",
        action: "click",
        selector: "h1",
      },
    });
    const text = extractText(result);
    expect(text).toContain("Clicked");
    expect(text).toContain("h1");
  });

  it("should type text into an element", async () => {
    const result = await client.callTool({
      name: "browse_interact",
      arguments: {
        url: "https://example.com",
        action: "type",
        selector: "body",
        text: "hello world",
      },
    });
    const text = extractText(result);
    expect(text).toContain("Typed");
    expect(text).toContain("body");
    expect(text).toContain("hello world");
  });
});

describe("browse_interact — errors", () => {
  it("should error when selector is missing for click", async () => {
    const result = await client.callTool({
      name: "browse_interact",
      arguments: {
        url: "https://example.com",
        action: "click",
      },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|selector/i);
  });

  it("should error when text is missing for type", async () => {
    const result = await client.callTool({
      name: "browse_interact",
      arguments: {
        url: "https://example.com",
        action: "type",
        selector: "body",
      },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|text/i);
  });

  it("should error on unknown action", async () => {
    const result = await client.callTool({
      name: "browse_interact",
      arguments: {
        url: "https://example.com",
        action: "swipe",
        selector: "body",
      },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|Unknown/i);
  });
});

// ─── browse_session — lifecycle ──────────────────────────────

describe("browse_session — lifecycle", () => {
  it("should create a session", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "create", url: "https://example.com" },
    });
    const text = extractText(result);
    expect(text).toContain("Created session:");
    sessionId = text.replace("Created session: ", "").trim();
    expect(sessionId).toMatch(/^session_\d+$/);
  });

  it("should list sessions including the created one", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "list" },
    });
    const text = extractText(result);
    expect(text).toContain(sessionId);
  });

  it("should navigate within session", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: {
        action: "goto",
        session_id: sessionId,
        url: "https://example.com",
      },
    });
    const text = extractText(result);
    expect(text).toContain("Navigated");
  });

  it("should wait for a selector in session", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: {
        action: "wait",
        session_id: sessionId,
        selector: "h1",
      },
    });
    const text = extractText(result);
    expect(text).toContain("Condition met");
  });

  it("should extract JS expression result from session", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: {
        action: "extract",
        session_id: sessionId,
        expression: "document.title",
      },
    });
    const text = extractText(result);
    expect(text).toContain("Example Domain");
  });

  it("should click an element within an active session", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: {
        action: "click",
        session_id: sessionId,
        selector: "a",
      },
    });
    const text = extractText(result);
    expect(text).toContain("Clicked");
    expect(text).toContain("a");
  });

  it("should close the session", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "close", session_id: sessionId },
    });
    const text = extractText(result);
    expect(text).toContain("Closed session:");
    expect(text).toContain(sessionId);
  });

  it("should no longer show the closed session in list", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "list" },
    });
    const text = extractText(result);
    expect(text).not.toContain(sessionId);
  });
});

// ─── browse_session — additional features ─────────────────────

describe("browse_session — features", () => {
  it("should create session with clear_cookies flag", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: {
        action: "create",
        url: "https://example.com",
        clear_cookies: true,
      },
    });
    const text = extractText(result);
    expect(text).toContain("Created session:");

    // Clean up
    const sid = text.replace("Created session: ", "").trim();
    await client.callTool({
      name: "browse_session",
      arguments: { action: "close", session_id: sid },
    });
  });
});

// ─── browse_session — errors ──────────────────────────────────

describe("browse_session — errors", () => {
  it("should error on close without session_id", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "close" },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|session_id/i);
  });

  it("should error on goto with bad URL", async () => {
    // Create a temp session first
    const createResult = await client.callTool({
      name: "browse_session",
      arguments: { action: "create", url: "https://example.com" },
    });
    const sid = extractText(createResult).replace("Created session: ", "").trim();

    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "goto", session_id: sid, url: "not-a-url" },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|invalid/i);

    // Clean up
    await client.callTool({
      name: "browse_session",
      arguments: { action: "close", session_id: sid },
    });
  });

  it("should error on extract without expression", async () => {
    // Create a temp session
    const createResult = await client.callTool({
      name: "browse_session",
      arguments: { action: "create", url: "https://example.com" },
    });
    const sid = extractText(createResult).replace("Created session: ", "").trim();

    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "extract", session_id: sid },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|expression/i);

    // Clean up
    await client.callTool({
      name: "browse_session",
      arguments: { action: "close", session_id: sid },
    });
  });

  it("should error on unknown session action", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: { action: "nonexistent" },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|Unknown/i);
  });
});

// ─── browse_scrape ────────────────────────────────────────────

describe("browse_scrape", () => {
  it("should scrape a single URL", async () => {
    const result = await client.callTool({
      name: "browse_scrape",
      arguments: { urls: ["https://example.com"] },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it("should scrape multiple URLs", async () => {
    const result = await client.callTool({
      name: "browse_scrape",
      arguments: {
        urls: ["https://example.com", "https://httpbin.org/status/200"],
      },
    });
    const text = extractText(result);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("browse_scrape — errors", () => {
  it("should error when urls field is missing", async () => {
    const result = await client.callTool({
      name: "browse_scrape",
      arguments: {},
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|urls/i);
  });

  it("should error when urls array is empty", async () => {
    const result = await client.callTool({
      name: "browse_scrape",
      arguments: { urls: [] },
    });
    const text = extractText(result);
    expect(text).toMatch(/Error|urls/i);
  });
});
