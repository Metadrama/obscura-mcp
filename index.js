#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const { ensureBinary, expectedBinaryName } = require("./scripts/install-obscura.js");

const MCP_HTTP_HOST = process.env.MCP_HTTP_HOST || "127.0.0.1";
const MCP_HTTP_PORT = Number(process.env.MCP_HTTP_PORT || "3000");
const MCP_HTTP_PATH = process.env.MCP_HTTP_PATH || "/mcp";
const OBSCURA_STARTUP_TIMEOUT_MS = Number(
  process.env.OBSCURA_STARTUP_TIMEOUT_MS || "15000",
);
const OBSCURA_NAVIGATION_WAIT_MS = Number(
  process.env.OBSCURA_NAVIGATION_WAIT_MS || "3000",
);
const CDP_REQUEST_TIMEOUT_MS = Number(
  process.env.CDP_REQUEST_TIMEOUT_MS || "10000",
);

function resolveObscuraPath() {
  if (process.env.OBSCURA_PATH) {
    return process.env.OBSCURA_PATH;
  }

  const localBinary = path.join(
    __dirname,
    "bin",
    process.platform === "win32" ? "obscura.exe" : "obscura",
  );

  if (fs.existsSync(localBinary)) {
    return localBinary;
  }

  return process.platform === "win32" ? "obscura.exe" : "obscura";
}

function getTransportMode() {
  const directArg = process.argv.find((arg) => arg.startsWith("--transport="));
  if (directArg) {
    return directArg.split("=")[1];
  }

  const transportIndex = process.argv.indexOf("--transport");
  if (transportIndex !== -1 && process.argv[transportIndex + 1]) {
    return process.argv[transportIndex + 1];
  }

  return process.env.MCP_TRANSPORT || "stdio";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    if (!match[1]) {
      continue;
    }

    try {
      links.push(new URL(match[1], baseUrl).toString());
    } catch {
      links.push(match[1]);
    }
  }

  return Array.from(new Set(links)).join("\n");
}

const SESSION_IDLE_TIMEOUT_MS = Number(
  process.env.OBSCURA_SESSION_TIMEOUT_MS || "300000",
);
const SESSION_CLEANUP_INTERVAL_MS = Number(
  process.env.OBSCURA_SESSION_CLEANUP_MS || "60000",
);

class SessionManager {
  constructor(cdpClient) {
    this.cdp = cdpClient;
    this.sessions = new Map();
    this.nextId = 1;
    this._startCleanup();
  }

  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      this._cleanupStale();
    }, SESSION_CLEANUP_INTERVAL_MS);
  }

  stop() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    for (const [id] of this.sessions) {
      this.close(id).catch(() => {});
    }
  }

  _cleanupStale() {
    const now = Date.now();
    for (const [id, sess] of this.sessions.entries()) {
      if (now - sess.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
        this.close(id).catch(() => {});
      }
    }
  }

  async create(url) {
    const target = await this.cdp.send("Target.createTarget", {
      url: url || "about:blank",
    });
    const targetId = target.targetId;
    if (!targetId) throw new Error("Failed to create target");

    const attached = await this.cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    if (!sessionId) throw new Error("Failed to attach to target");

    await this.cdp.send("Page.enable", {}, sessionId).catch(() => {});
    await this.cdp.send("DOM.enable", {}, sessionId).catch(() => {});

    const id = `session_${this.nextId++}`;
    this.sessions.set(id, { id, targetId, sessionId, createdAt: Date.now(), lastUsedAt: Date.now() });
    return id;
  }

  get(id) {
    const sess = this.sessions.get(id);
    if (!sess) throw new Error(`Session not found: ${id}`);
    sess.lastUsedAt = Date.now();
    return sess;
  }

  async close(id) {
    const sess = this.sessions.get(id);
    if (!sess) return;
    this.sessions.delete(id);
    await this.cdp.send("Target.closeTarget", { targetId: sess.targetId }).catch(() => {});
  }

  list() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      createdAt: new Date(s.createdAt).toISOString(),
      lastUsedAt: new Date(s.lastUsedAt).toISOString(),
    }));
  }
}

class CdpClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.endpoint);
      this.socket = socket;

      socket.once("open", resolve);
      socket.once("error", reject);
      socket.on("message", (raw) => this.handleMessage(raw));
      socket.on("close", () => this.rejectPending("CDP connection closed"));
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    if (!message.id || !this.pending.has(message.id)) {
      return;
    }

    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);

    if (message.error) {
      const error = new Error(
        message.error.message || JSON.stringify(message.error),
      );
      error.cdpError = message.error;
      pending.reject(error);
      return;
    }

    pending.resolve(message.result || {});
  }

  rejectPending(message) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  send(method, params = {}, sessionId) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP connection is not open"));
    }

    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) {
      message.sessionId = sessionId;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, CDP_REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify(message), (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    if (this.socket) {
      this.socket.close();
    }
    this.rejectPending("CDP connection closed");
  }
}

class ObscuraServer {
  constructor() {
    this.obscuraProcess = null;
    this.cdp = null;
    this.sessions = null;
    this.server = new Server(
      {
        name: "mcp-obscura",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupTools();
  }

  validateUrl(input) {
    if (!input || typeof input !== "string") {
      throw new Error("Invalid argument: url is required");
    }

    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error("Invalid argument: url must be a valid URL");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid argument: only http and https URLs are supported");
    }

    return parsed.toString();
  }

  async withPage(url, callback, cookies, sessionId) {
    if (!this.cdp) {
      throw new Error("Obscura CDP client is not connected.");
    }

    // Session mode: use existing session instead of creating a new target
    if (sessionId) {
      const sess = this.sessions.get(sessionId);
      if (url) {
        await this.cdp.send("Page.navigate", { url }, sess.sessionId);
        await delay(OBSCURA_NAVIGATION_WAIT_MS);
      }
      return await callback(sess.sessionId, sess.targetId);
    }

    let targetId;
    let sessId;

    try {
      const target = await this.cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      targetId = target.targetId;
      if (!targetId) {
        throw new Error("Obscura did not return a target id.");
      }

      const attached = await this.cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      sessId = attached.sessionId;
      if (!sessId) {
        throw new Error("Obscura did not return a CDP session id.");
      }

      await this.cdp.send("Page.enable", {}, sessId).catch(() => {});
      await this.cdp.send("DOM.enable", {}, sessId).catch(() => {});
      if (cookies && cookies.length > 0) {
        // Strip leading dot from domain if present — Network.getCookies
        // returns domains with leading dot (e.g. ".example.com") but
        // Network.setCookies may reject them.
        const cleaned = cookies.map((c) => {
          const copy = { ...c };
          if (copy.domain && copy.domain.startsWith(".")) {
            copy.domain = copy.domain.slice(1);
          }
          // If url is provided without domain, set domain from url for
          // broader compatibility
          if (copy.url && !copy.domain) {
            try {
              copy.domain = new URL(copy.url).hostname;
            } catch {}
          }
          return copy;
        });
        await this.cdp
          .send("Network.setCookies", { cookies: cleaned }, sessId)
          .catch(() => {});
      }
      await this.cdp.send("Page.navigate", { url }, sessId);
      await delay(OBSCURA_NAVIGATION_WAIT_MS);

      return await callback(sessId, targetId);
    } finally {
      if (targetId && this.cdp) {
        await this.cdp
          .send("Target.closeTarget", { targetId })
          .catch(() => {});
      }
    }
  }

  async getOuterHtml(sessionId) {
    const docResult = await this.cdp.send("DOM.getDocument", {}, sessionId);
    if (docResult?.root?.nodeId === undefined || docResult?.root?.nodeId === null) {
      throw new Error("Obscura did not return a document root.");
    }

    let nodeId = docResult.root.nodeId;
    for (const child of docResult.root.children || []) {
      if (child.nodeType !== 10 && child.nodeName?.toLowerCase() === "html") {
        nodeId = child.nodeId;
        break;
      }
    }

    const outerHTML = await this.cdp.send(
      "DOM.getOuterHTML",
      { nodeId },
      sessionId,
    );
    return outerHTML?.outerHTML || "";
  }

  async browseUrl(args = {}) {
    const url = this.validateUrl(args.url);
    const dump = ["html", "text", "links"].includes(args.dump)
      ? args.dump
      : "html";
    const cookies = Array.isArray(args.cookies) ? args.cookies : [];

    return await this.withPage(url, async (sessionId) => {
      const html = await this.getOuterHtml(sessionId);

      if (dump === "text") {
        return stripHtml(html);
      }

      if (dump === "links") {
        return extractLinks(html, url);
      }

      return html;
    }, cookies);
  }

  async evaluate(args = {}) {
    const url = this.validateUrl(args.url);
    const expression = args.expression;

    return await this.withPage(url, async (sessionId) => {
      const result = await this.cdp.send(
        "Runtime.evaluate",
        { expression },
        sessionId,
      );

      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception || result.exceptionDetails;
        throw new Error(
          `JS exception: ${detail.description || detail.text || JSON.stringify(detail)}`,
        );
      }

      if (result.result === undefined || result.result === null) {
        return "undefined";
      }

      const value = result.result.value ?? result.result.description ?? JSON.stringify(result.result);
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }

  async getCookies(args = {}) {
    const url = this.validateUrl(args.url);

    return await this.withPage(url, async (sessionId) => {
      await this.cdp.send("Network.enable", {}, sessionId).catch(() => {});
      const result = await this.cdp.send("Network.getCookies", {}, sessionId);
      const cookies = result.cookies || [];

      if (cookies.length === 0) {
        return "No cookies found for this page.";
      }

      return cookies
        .map(
          (c) =>
            `${c.name}=${c.value} (domain: ${c.domain}, path: ${c.path}${c.expires && c.expires > 0 ? `, expires: ${new Date(c.expires * 1000).toISOString()}` : ", session"})`,
        )
        .join("\n");
    });
  }

  async pageToMarkdown(args = {}) {
    const url = this.validateUrl(args.url);
    const cookies = Array.isArray(args.cookies) ? args.cookies : [];

    return await this.withPage(url, async (sessionId) => {
      const result = await this.cdp.send("LP.getMarkdown", {}, sessionId);
      return result?.markdown || "";
    }, cookies);
  }

  async browseClick(args = {}) {
    const sessionId = args.session_id;
    const selector = args.selector;
    if (!selector || typeof selector !== "string") {
      throw new Error("Invalid argument: selector is required");
    }
    // Session mode: URL is optional
    // One-shot mode: URL required
    const url = sessionId ? (args.url || null) : this.validateUrl(args.url);

    return await this.withPage(url, async (sessId) => {
      // Get element position via JS
      const rectResult = await this.cdp.send(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify((() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { error: "Element not found" };
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })())`,
        },
        sessId,
      );

      const raw = rectResult?.result?.value;
      if (!raw) {
        throw new Error("Failed to locate element");
      }

      let rect;
      try { rect = JSON.parse(raw); } catch {}
      if (!rect || rect.error) {
        throw new Error(rect?.error || "Failed to locate element");
      }

      // Dispatch mouse click
      await this.cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 },
        sessId,
      );

      await this.cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 },
        sessId,
      );

      return `Clicked "${selector}" at (${Math.round(rect.x)}, ${Math.round(rect.y)})`;
    }, null, sessionId);
  }

  async browseType(args = {}) {
    const sessionId = args.session_id;
    const selector = args.selector;
    if (!selector || typeof selector !== "string") {
      throw new Error("Invalid argument: selector is required");
    }
    const text = args.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("Invalid argument: text is required");
    }
    const url = sessionId ? (args.url || null) : this.validateUrl(args.url);

    return await this.withPage(url, async (sessId) => {
      // Focus the element first
      const focusResult = await this.cdp.send(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify((() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { error: "Element not found" };
            el.focus();
            el.value = "";
            return { focused: true };
          })())`,
        },
        sessId,
      );

      const focusRaw = focusResult?.result?.value;
      if (!focusRaw) {
        throw new Error("Failed to focus element");
      }

      let focusVal;
      try { focusVal = JSON.parse(focusRaw); } catch {}
      if (!focusVal || focusVal.error) {
        throw new Error(focusVal?.error || "Failed to focus element");
      }

      // Dispatch key events for each character
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const keyCode = char.charCodeAt(0);

        await this.cdp.send(
          "Input.dispatchKeyEvent",
          {
            type: "rawKeyDown",
            windowsVirtualKeyCode: keyCode,
            key: char,
            code: `Key${char.toUpperCase()}`,
            text: char,
          },
          sessId,
        );

        await this.cdp.send(
          "Input.dispatchKeyEvent",
          { type: "char", text: char, key: char, windowsVirtualKeyCode: keyCode },
          sessId,
        );

        await this.cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", windowsVirtualKeyCode: keyCode, key: char, code: `Key${char.toUpperCase()}` },
          sessId,
        );
      }

      return `Typed "${text}" into "${selector}" (${text.length} characters)`;
    }, null, sessionId);
  }

  async sessionCreate(args = {}) {
    const url = args.url ? this.validateUrl(args.url) : null;
    const id = await this.sessions.create(url);
    return `Created session: ${id}`;
  }

  async sessionClose(args = {}) {
    const id = args.session_id;
    if (!id) throw new Error("Invalid argument: session_id is required");
    await this.sessions.close(id);
    return `Closed session: ${id}`;
  }

  async sessionList() {
    const list = this.sessions.list();
    if (list.length === 0) return "No active sessions.";
    return list.map((s) => `  ${s.id} (created: ${s.createdAt}, last used: ${s.lastUsedAt})`).join("\n");
  }

  async browseGoto(args = {}) {
    const id = args.session_id;
    if (!id) throw new Error("Invalid argument: session_id is required");
    const url = this.validateUrl(args.url);
    const sess = this.sessions.get(id);
    await this.cdp.send("Page.navigate", { url }, sess.sessionId);
    await delay(OBSCURA_NAVIGATION_WAIT_MS);
    return `Navigated to ${url}`;
  }

  async browseWait(args = {}) {
    const id = args.session_id;
    if (!id) throw new Error("Invalid argument: session_id is required");
    const selector = args.selector;
    const expression = args.expression;
    const timeoutMs = Math.min(Math.max(1000, Number(args.timeout) || 30000), 120000);
    const sess = this.sessions.get(id);

    const condition = selector
      ? `document.querySelector(${JSON.stringify(selector)}) !== null`
      : expression;

    if (!condition) throw new Error("Invalid argument: selector or expression is required");

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await this.cdp.send("Runtime.evaluate", { expression: condition }, sess.sessionId);
      if (result?.result?.value === true || result?.result?.value === "true") {
        return `Condition met after ${Date.now() - start}ms`;
      }
      await delay(500);
    }
    throw new Error(`Timeout after ${timeoutMs}ms waiting for condition`);
  }

  async browseExtract(args = {}) {
    const id = args.session_id;
    if (!id) throw new Error("Invalid argument: session_id is required");
    const expression = args.expression;
    if (!expression || typeof expression !== "string") throw new Error("Invalid argument: expression is required");
    const sess = this.sessions.get(id);
    const result = await this.cdp.send("Runtime.evaluate", { expression }, sess.sessionId);
    if (result.exceptionDetails) {
      throw new Error(`JS exception: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`);
    }
    const value = result.result?.value ?? result.result?.description ?? JSON.stringify(result.result);
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "browse_url",
          description:
            "Fetch a URL using Obscura's lightweight CDP engine. To access authenticated pages, pass cookies previously exported from browse_cookies.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to visit" },
              dump: {
                type: "string",
                enum: ["html", "text", "links"],
                default: "html",
                description: "The format to return content in",
              },
              cookies: {
                type: "array",
                description:
                  "Optional cookies to inject before navigation. Accepts the same format as returned by browse_cookies — an array of objects with at least name and value. Pass cookies exported from a real browser session to access authenticated pages.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" },
                    domain: { type: "string" },
                    path: { type: "string" },
                    secure: { type: "boolean" },
                    httpOnly: { type: "boolean" },
                    sameSite: { type: "string" },
                    expires: { type: "number" },
                  },
                  required: ["name", "value"],
                },
              },
              stealth: {
                type: "boolean",
                default: true,
                description:
                  "Accepted for compatibility. Stealth behavior is controlled by the Obscura server.",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "browse_evaluate",
          description:
            "Navigate to a URL and execute JavaScript in the page context. Returns the evaluated result as a string. Supports extracting data, clicking elements, filling forms, and reading page state.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to visit" },
              expression: {
                type: "string",
                description:
                  "JavaScript expression to evaluate in the page context. The result is JSON-stringified. Examples: 'document.title', 'navigator.userAgent', 'document.querySelector(\"h1\").textContent'",
              },
              stealth: {
                type: "boolean",
                default: true,
                description:
                  "Accepted for compatibility. Stealth behavior is controlled by the Obscura server.",
              },
            },
            required: ["url", "expression"],
          },
        },
        {
          name: "browse_cookies",
          description:
            "Navigate to a URL and retrieve all cookies set by the page. Returns cookie name, value, domain, path, and expiry for each cookie.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to visit" },
              stealth: {
                type: "boolean",
                default: true,
                description:
                  "Accepted for compatibility. Stealth behavior is controlled by the Obscura server.",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "page_to_markdown",
          description:
            "Navigate to a URL and convert the page content to clean Markdown. Uses Obscura's LP.getMarkdown CDP method. Returns the full page as formatted markdown text.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to visit" },
              cookies: {
                type: "array",
                description:
                  "Optional cookies to inject before navigation. An array of objects with at least name and value.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" },
                    domain: { type: "string" },
                    path: { type: "string" },
                    secure: { type: "boolean" },
                    httpOnly: { type: "boolean" },
                    sameSite: { type: "string" },
                    expires: { type: "number" },
                  },
                  required: ["name", "value"],
                },
              },
              stealth: {
                type: "boolean",
                default: true,
                description:
                  "Accepted for compatibility. Stealth behavior is controlled by the Obscura server.",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "browse_click",
          description:
            "Navigate to a URL and click on an element identified by a CSS selector. Uses Input.dispatchMouseEvent CDP. Returns the coordinates where the click was dispatched.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to visit (optional if session_id is provided)" },
              session_id: {
                type: "string",
                description: "Optional session ID for persistent browsing. If provided, the click is performed on the existing session page instead of creating a new one.",
              },
              selector: {
                type: "string",
                description:
                  "CSS selector for the element to click (e.g. 'a', '#submit', 'button.primary')",
              },
              stealth: {
                type: "boolean",
                default: true,
                description:
                  "Accepted for compatibility. Stealth behavior is controlled by the Obscura server.",
              },
            },
            required: ["selector"],
          },
        },
        {
          name: "browse_type",
          description:
            "Navigate to a URL, focus an element, and type text into it. Uses Input.dispatchKeyEvent CDP. Returns what was typed and where.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to visit (optional if session_id is provided)" },
              session_id: {
                type: "string",
                description: "Optional session ID for persistent browsing. If provided, the typing is performed on the existing session page instead of creating a new one.",
              },
              selector: {
                type: "string",
                description:
                  "CSS selector for the input element to type into (e.g. '#username', 'input[name=\"q\"]')",
              },
              text: {
                type: "string",
                description: "The text to type into the element",
              },
              stealth: {
                type: "boolean",
                default: true,
                description:
                  "Accepted for compatibility. Stealth behavior is controlled by the Obscura server.",
              },
            },
            required: ["selector", "text"],
          },
        },
        {
          name: "session_create",
          description:
            "Create a new persistent browsing session. Returns a session ID that can be used with other session-aware tools. The session keeps a page open until explicitly closed or after 5 minutes of inactivity.",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Optional URL to navigate to immediately on session creation",
              },
            },
          },
        },
        {
          name: "session_close",
          description:
            "Close a persistent browsing session and release its resources.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "The session ID to close",
              },
            },
            required: ["session_id"],
          },
        },
        {
          name: "session_list",
          description:
            "List all active persistent browsing sessions with their creation and last-used timestamps.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "browse_goto",
          description:
            "Navigate an existing session to a new URL. The session's page remains alive after navigation.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "The session ID to navigate",
              },
              url: { type: "string", description: "The URL to navigate to" },
            },
            required: ["session_id", "url"],
          },
        },
        {
          name: "browse_wait",
          description:
            "Wait for a condition in an existing session. Can wait for a CSS selector to appear or a JavaScript expression to return true. Useful for waiting for 2FA prompts, redirects, or dynamic content.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "The session ID",
              },
              selector: {
                type: "string",
                description: "CSS selector to wait for (e.g. '.otp-input', '#2fa-form')",
              },
              expression: {
                type: "string",
                description: "JavaScript expression that should return true (alternative to selector)",
              },
              timeout: {
                type: "number",
                default: 30000,
                description: "Maximum wait time in milliseconds (1000-120000, default 30000)",
              },
            },
            required: ["session_id"],
          },
        },
        {
          name: "browse_extract",
          description:
            "Execute a JavaScript expression in an existing session and return the result. Useful for reading page state, extracting data, or checking conditions after navigation.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "The session ID",
              },
              expression: {
                type: "string",
                description:
                  "JavaScript expression to evaluate. Examples: 'document.title', 'document.querySelector(\".balance\").textContent'",
              },
            },
            required: ["session_id", "expression"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "browse_url") {
          const output = await this.browseUrl(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "browse_evaluate") {
          if (!args || !args.expression) {
            throw new Error("expression is required");
          }
          const output = await this.evaluate(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "browse_cookies") {
          const output = await this.getCookies(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "page_to_markdown") {
          const output = await this.pageToMarkdown(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "browse_click") {
          const output = await this.browseClick(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "browse_type") {
          const output = await this.browseType(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "session_create") {
          const output = await this.sessionCreate(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "session_close") {
          const output = await this.sessionClose(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "session_list") {
          const output = await this.sessionList();
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "browse_goto") {
          const output = await this.browseGoto(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "browse_wait") {
          const output = await this.browseWait(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        if (name === "browse_extract") {
          const output = await this.browseExtract(args);
          return {
            content: [{ type: "text", text: output }],
          };
        }

        throw new Error(`Tool not found: ${name}`);
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Execution Error: ${error.message}` },
          ],
          isError: true,
        };
      }
    });
  }

  async runStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Obscura MCP Server running on stdio");
  }

  async runHttp() {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await this.server.connect(transport);

    const server = http.createServer(async (req, res) => {
      try {
        const requestUrl = new URL(
          req.url || "/",
          `http://${req.headers.host || "localhost"}`,
        );

        if (requestUrl.pathname !== MCP_HTTP_PATH) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        await transport.handleRequest(req, res);
      } catch (error) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: error.message || "Internal server error",
              },
              id: null,
            }),
          );
        }
      }
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(MCP_HTTP_PORT, MCP_HTTP_HOST, resolve);
    });

    console.error(
      `Obscura MCP Server running on streamable HTTP at http://${MCP_HTTP_HOST}:${MCP_HTTP_PORT}${MCP_HTTP_PATH}`,
    );
  }

  async startObscuraService() {
    // Clean up any stale Obscura process from a prior Hermes session that
    // was orphaned when the parent node process received SIGKILL. Without
    // this, the fixed port 9222 stays locked and the new spawn fails with
    // EADDRINUSE on every retry.
    try {
      const { execSync } = require("child_process");
      execSync("pkill -x obscura 2>/dev/null", { stdio: "ignore" });
    } catch {
      // pkill not available or no matching process — both fine
    }

    // Lazy download: if local binary doesn't exist, fetch from GitHub.
    // This handles npm upgrades where postinstall binary was nuked.
    const localBinary = path.join(
      __dirname,
      "bin",
      expectedBinaryName(),
    );
    if (!fs.existsSync(localBinary)) {
      console.error("Obscura binary not found. Downloading from GitHub...");
      await ensureBinary();
    }

    return new Promise((resolve, reject) => {
      const obscuraPath = resolveObscuraPath();
      let settled = false;
      let outputBuffer = "";

      const fail = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(startupTimer);
        cleanupListeners();
        if (this.obscuraProcess) {
          this.obscuraProcess.kill("SIGTERM");
        }
        reject(error);
      };

      const succeed = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(startupTimer);
        cleanupListeners();
        resolve();
      };

      const cleanupListeners = () => {
        if (!this.obscuraProcess) {
          return;
        }
        this.obscuraProcess.stdout.removeListener("data", onData);
        this.obscuraProcess.stderr.removeListener("data", onData);
      };

      const startupTimer = setTimeout(() => {
        fail(
          new Error(
            `Timed out after ${OBSCURA_STARTUP_TIMEOUT_MS}ms waiting for Obscura CDP server. ` +
              `Recent output: ${outputBuffer.trim() || "(none)"}`,
          ),
        );
      }, OBSCURA_STARTUP_TIMEOUT_MS);

      const onData = async (chunk) => {
        const output = chunk.toString("utf8");
        outputBuffer = `${outputBuffer}${output}`.slice(-4000);
        console.error(`Obscura Service: ${output.trim()}`);
        const match = outputBuffer.match(/CDP server:\s*(ws:\/\/[^\s]+)/);
        if (!match || !match[1]) {
          return;
        }

        try {
          this.cdp = new CdpClient(match[1]);
          await this.cdp.connect();
          console.error(`Connected to Obscura CDP at ${match[1]}`);
          this.sessions = new SessionManager(this.cdp);
          succeed();
        } catch (error) {
          fail(new Error(`Failed to connect to Obscura CDP: ${error.message}`));
        }
      };

      if (path.isAbsolute(obscuraPath) && !fs.existsSync(obscuraPath)) {
        clearTimeout(startupTimer);
        reject(new Error(`Obscura binary not found: ${obscuraPath}`));
        return;
      }

      console.error("Starting Obscura service...");
      console.error(`Using Obscura binary: ${obscuraPath}`);
      this.obscuraProcess = spawn(obscuraPath, ["serve"], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.obscuraProcess.stdout.on("data", onData);
      this.obscuraProcess.stderr.on("data", onData);

      this.obscuraProcess.on("error", (error) => {
        fail(
          new Error(
            `Failed to start Obscura service binary (${obscuraPath}): ${error.message}`,
          ),
        );
      });

      this.obscuraProcess.on("close", (code) => {
        const message = `Obscura service process exited with code ${code}`;
        console.error(message);
        this.obscuraProcess = null;
        this.cdp = null;
        if (!settled) {
          fail(new Error(`${message} before MCP server was ready.`));
        }
      });
    });
  }

  async stopObscuraService() {
    if (this.sessions) {
      this.sessions.stop();
      this.sessions = null;
    }
    if (this.cdp) {
      this.cdp.close();
      this.cdp = null;
    }
    if (this.obscuraProcess) {
      this.obscuraProcess.kill("SIGTERM");
    }
  }

  async run() {
    await this.startObscuraService();
    const mode = getTransportMode();
    if (mode === "http") {
      await this.runHttp();
      return;
    }

    if (mode !== "stdio") {
      throw new Error(`Unsupported transport mode: ${mode}`);
    }

    await this.runStdio();
  }
}

const server = new ObscuraServer();

const arg = process.argv[2];

// --version / -v / --v: print and exit immediately
if (arg === "--version" || arg === "-v" || arg === "--v") {
  console.log(require("./package.json").version);
  process.exit(0);
}

// install: download binary with progress and exit
if (arg === "install") {
  ensureBinary()
    .then((binPath) => {
      console.log("Obscura binary ready at", binPath);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed:", err.message);
      process.exit(1);
    });
  return; // keep process alive until promise resolves
}

// Everything else: ensure binary, then start MCP server
async function main() {
  await ensureBinary();
  await server.run();
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.error("Caught interrupt signal, shutting down...");
  await server.stopObscuraService();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stopObscuraService();
  process.exit(0);
});
