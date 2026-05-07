/**
 * obscura-mcp integration tests — Vitex + StdioClientTransport
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

// ─── Test 1: tools/list ─────────────────────────────────────────
describe("tools/list", () => {
  it("should include axtree and layout in browse_page format enum", async () => {
    const result = await client.listTools();

    const browsePage = result.tools.find(
      (t: { name: string }) => t.name === "browse_page",
    );
    expect(browsePage).toBeDefined();

    const formatEnum: string[] =
      browsePage?.inputSchema?.properties?.format?.enum ?? [];
    expect(formatEnum).toContain("axtree");
    expect(formatEnum).toContain("layout");
  });
});

// ─── Test 2: browse_page format=axtree ──────────────────────────
describe("browse_page — axtree", () => {
  it("should return an accessibility tree", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "axtree" },
    });

    const text =
      (result.content as Array<{ type: string; text: string }>)?.[0]?.text ??
      "";
    expect(text).toMatch(/RootWebArea|generic|heading|StaticText/i);
  });
});

// ─── Test 3: browse_page format=layout ──────────────────────────
describe("browse_page — layout", () => {
  it("should return layout metrics", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "layout" },
    });

    const text =
      (result.content as Array<{ type: string; text: string }>)?.[0]?.text ??
      "";
    expect(text).toMatch(/viewport|width|height|zoom|scale|content/i);
  });
});

// ─── Test 4: browse_page user_agent override ────────────────────
describe("browse_page — user_agent", () => {
  it("should load a page with a custom user agent", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: {
        url: "https://example.com",
        format: "text",
        user_agent: "TestBot/1.0",
      },
    });

    const text =
      (result.content as Array<{ type: string; text: string }>)?.[0]?.text ??
      "";
    expect(text.length).toBeGreaterThan(20);
  });
});

// ─── Test 5: browse_page custom headers ─────────────────────────
describe("browse_page — headers", () => {
  it("should load a page with custom headers", async () => {
    const result = await client.callTool({
      name: "browse_page",
      arguments: {
        url: "https://example.com",
        format: "text",
        headers: { "X-Test": "hello123" },
      },
    });

    const text =
      (result.content as Array<{ type: string; text: string }>)?.[0]?.text ??
      "";
    expect(text.length).toBeGreaterThan(20);
  });
});

// ─── Test 6: browse_session clear_cookies ───────────────────────
describe("browse_session — create with clear_cookies", () => {
  it("should create a session with cookie clearing", async () => {
    const result = await client.callTool({
      name: "browse_session",
      arguments: {
        action: "create",
        url: "https://example.com",
        clear_cookies: true,
      },
    });

    const text =
      (result.content as Array<{ type: string; text: string }>)?.[0]?.text ??
      "";
    expect(text).toContain("session");
  });
});

// ─── Test 7: event-driven nav timing ────────────────────────────
describe("browse_page — timing", () => {
  it("should load a page quickly with event-driven navigation", async () => {
    const start = performance.now();

    const result = await client.callTool({
      name: "browse_page",
      arguments: { url: "https://example.com", format: "text" },
    });

    const elapsed = performance.now() - start;
    const text =
      (result.content as Array<{ type: string; text: string }>)?.[0]?.text ??
      "";

    expect(text.length).toBeGreaterThan(20);
    expect(elapsed).toBeLessThan(15_000);
  });
});
