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
const http = require("http");

// Configuration
const OBSCURA_PATH = process.env.OBSCURA_PATH || "obscura";
const MCP_HTTP_HOST = process.env.MCP_HTTP_HOST || "127.0.0.1";
const MCP_HTTP_PORT = Number(process.env.MCP_HTTP_PORT || "3000");
const MCP_HTTP_PATH = process.env.MCP_HTTP_PATH || "/mcp";
const OBSCURA_TIMEOUT_MS = Number(process.env.OBSCURA_TIMEOUT_MS || "30000");
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || "1048576");

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

class ObscuraServer {
  constructor() {
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

  runObscura(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(OBSCURA_PATH, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, OBSCURA_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start Obscura binary: ${error.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(
            new Error(
              `Obscura command timed out after ${OBSCURA_TIMEOUT_MS}ms`,
            ),
          );
          return;
        }

        if (code !== 0) {
          const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
          reject(new Error(`Obscura command failed: ${details}`));
          return;
        }

        resolve(stdout);
      });
    });
  }

  async browseUrl(args = {}) {
    const url = this.validateUrl(args.url);
    const dump = ["html", "text", "links"].includes(args.dump)
      ? args.dump
      : "html";

    const cmdArgs = ["fetch", url, "--dump", dump];
    if (args.stealth !== false) {
      cmdArgs.push("--stealth");
    }

    return this.runObscura(cmdArgs);
  }

  setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "browse_url",
          description:
            "Fetch a URL using Obscura's native high-performance engine. This bypasses typical bot detection.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to visit" },
              dump: {
                type: "string",
                enum: ["html", "text", "links"],
                default: "html",
                description:
                  "The format to return the content in (Obscura native modes)",
              },
              stealth: {
                type: "boolean",
                default: true,
                description: "Enable stealth mode anti-detection",
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

  async readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let data = "";

      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        size += Buffer.byteLength(chunk, "utf8");
        if (size > MAX_BODY_BYTES) {
          reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
          req.destroy();
          return;
        }
        data += chunk;
      });

      req.on("end", () => {
        if (!data) {
          resolve(undefined);
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });

      req.on("error", reject);
    });
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

        const parsedBody = req.method === "POST" ? await this.readBody(req) : undefined;
        await transport.handleRequest(req, res, parsedBody);
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

  async run() {
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
  console.error("Fatal error running server:", error);
  process.exit(1);
});
