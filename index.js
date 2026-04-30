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
    this.server = new Server(
      {
        name: "mcp-obscura",
        version: "1.0.3",
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

  async withPage(url, callback) {
    if (!this.cdp) {
      throw new Error("Obscura CDP client is not connected.");
    }

    let targetId;
    let sessionId;

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
      sessionId = attached.sessionId;
      if (!sessionId) {
        throw new Error("Obscura did not return a CDP session id.");
      }

      await this.cdp.send("Page.enable", {}, sessionId).catch(() => {});
      await this.cdp.send("DOM.enable", {}, sessionId).catch(() => {});
      await this.cdp.send("Page.navigate", { url }, sessionId);
      await delay(OBSCURA_NAVIGATION_WAIT_MS);

      return await callback(sessionId, targetId);
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

    return await this.withPage(url, async (sessionId) => {
      const html = await this.getOuterHtml(sessionId);

      if (dump === "text") {
        return stripHtml(html);
      }

      if (dump === "links") {
        return extractLinks(html, url);
      }

      return html;
    });
  }

  setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "browse_url",
          description:
            "Fetch a URL using Obscura's lightweight CDP engine.",
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

  startObscuraService() {
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
server.run().catch((error) => {
  console.error("Fatal error running adapter:", error);
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
