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
const path = require("path");
const puppeteer = require("puppeteer-core");
const http = require("http");

// Configuration
const MCP_HTTP_HOST = process.env.MCP_HTTP_HOST || "127.0.0.1";
const MCP_HTTP_PORT = Number(process.env.MCP_HTTP_PORT || "3000");
const MCP_HTTP_PATH = process.env.MCP_HTTP_PATH || "/mcp";
const OBSCURA_TIMEOUT_MS = Number(process.env.OBSCURA_TIMEOUT_MS || "30000");

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

class ObscuraServer {
  constructor() {
    this.obscuraProcess = null;
    this.browser = null;
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

  async browseUrl(args = {}) {
    const url = this.validateUrl(args.url);
    const dump = ["html", "text", "links"].includes(args.dump)
      ? args.dump
      : "html";
    
    // TODO: The 'stealth' parameter from the original CLI is not directly mapped here.
    // Obscura's server mode inherently uses stealth capabilities.
    
    if (!this.browser) {
      throw new Error("Obscura browser is not connected.");
    }

    // Use raw CDP to create a new target and navigate
    try {
      // Create a new target (page) using raw CDP
      const browserWSEndpoint = this.browser._connection._url;
      const newTargetResponse = await this.browser._connection.send("Target.createTarget", { url: "about:blank" });
      const targetId = newTargetResponse.targetId;
      
      // Wait a moment for target to initialize
      await new Promise(r => setTimeout(r, 1000));
      
      // Attach to the target and navigate
      const session = await this.browser._connection.createSession({ targetId });
      
      // Enable basic domains before navigating
      try {
        await session.send("Page.enable", {});
        await session.send("DOM.enable", {});
        await session.send("Runtime.enable", {});
      } catch (e) {
        // Ignore domain enable errors - these domains may not be available
      }
      
      // Navigate
      await session.send("Page.navigate", { url });
      
      // Wait for page to load
      await new Promise(r => setTimeout(r, 3000));
      
      // Extract content using DOM protocol (more reliable than Runtime.evaluate with Obscura)
      let output = "";
      try {
        // Get the document
        const docResult = await session.send("DOM.getDocument", {});
        if (docResult?.root?.nodeId === undefined || docResult?.root?.nodeId === null) {
          throw new Error("Failed to get document root");
        }
        
        const rootNodeId = docResult.root.nodeId;
        
        // Find the HTML element - skip DOCTYPE (nodeType 10)
        let htmlNodeId = null;
        if (docResult.root.children && docResult.root.children.length > 0) {
          for (const child of docResult.root.children) {
            // Skip DOCTYPE (nodeType 10) - we want the actual HTML element (nodeType 1)
            if (child.nodeType !== 10 && child.nodeName.toLowerCase() === "html") {
              htmlNodeId = child.nodeId;
              break;
            }
          }
        }
        
        if (htmlNodeId === null || htmlNodeId === undefined) {
          htmlNodeId = rootNodeId; // Fallback to root
        }
        
        // Get content based on dump type
        if (dump === "html") {
          // Get full HTML
          const outerHTML = await session.send("DOM.getOuterHTML", { nodeId: htmlNodeId });
          output = outerHTML?.outerHTML || "";
        } else if (dump === "text") {
          // Get all text by extracting from HTML and removing tags
          const outerHTML = await session.send("DOM.getOuterHTML", { nodeId: htmlNodeId });
          const html = outerHTML?.outerHTML || "";
          // Remove script and style tags
          let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
          text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
          // Remove HTML tags
          text = text.replace(/<[^>]+>/g, ' ');
          // Decode HTML entities and normalize whitespace
          text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
          output = text;
        } else if (dump === "links") {
          // Find all anchor tags in HTML
          const outerHTML = await session.send("DOM.getOuterHTML", { nodeId: htmlNodeId });
          const html = outerHTML?.outerHTML || "";
          // Extract href values
          const linkRegex = /href=["']([^"']+)["']/gi;
          let match;
          const links = [];
          while ((match = linkRegex.exec(html)) !== null) {
            if (match[1]) {
              links.push(match[1]);
            }
          }
          // Remove duplicates
          output = Array.from(new Set(links)).join("\n");
        }
      } catch (extractErr) {
        output = ""; // Return empty on error - better than error message
      } finally {
        // Always close the session
        await this.browser._connection.send("Target.closeTarget", { targetId }).catch(() => {});
      }
      
      return output;
    } catch (error) {
      // Fallback: try using Puppeteer's normal API
      let page;
      try {
        page = await this.browser.newPage();
      } catch (pageErr) {
        throw error;  // Return original error if fallback also fails
      }
      
      try {
        await page.goto(url, { waitUntil: 'domContentLoaded', timeout: OBSCURA_TIMEOUT_MS });
        
        // Extract content based on dump type
        if (dump === "text") {
          return await page.evaluate(() => document.body.innerText);
        }
        
        if (dump === "links") {
          return await page.evaluate(() =>
            Array.from(document.querySelectorAll("a"), (a) => a.href).join(
              "\n",
            ),
          );
        }
        
        return await page.content();
      } finally {
        if (page) {
          await page.close();
        }
      }
    }
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
      console.error("Starting Obscura service...");
      this.obscuraProcess = spawn(obscuraPath, ["serve"], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      console.error(`Using Obscura binary: ${obscuraPath}`);

      const onData = async (chunk) => {
        const output = chunk.toString("utf8");
        console.error(`Obscura Service: ${output.trim()}`);
        const match = output.match(/CDP server: (ws:\/\/.*)/);
        if (match && match[1]) {
          const endpoint = match[1];
          console.error(`Obscura listening on ${endpoint}, connecting...`);
          try {
            this.browser = await puppeteer.connect({
              browserWSEndpoint: endpoint,
              defaultViewport: null,
            });
            
            // Patch the connection to suppress "Unknown domain" errors from Puppeteer trying to use unsupported CDP domains
            const originalSend = this.browser._connection.send.bind(this.browser._connection);
            this.browser._connection.send = async function(method, params, ...args) {
              try {
                return await originalSend(method, params, ...args);
              } catch (err) {
                if (err.message && err.message.includes("Unknown domain")) {
                  return undefined; // Suppress and return undefined
                }
                throw err;
              }
            };
            
            console.error("Successfully connected to Obscura browser.");
            this.obscuraProcess.stderr.removeListener("data", onData);
            resolve();
          } catch (error) {
            reject(new Error(`Failed to connect to Obscura via CDP: ${error.message}`));
          }
        }
      };

      this.obscuraProcess.stdout.on("data", onData);
      this.obscuraProcess.stderr.on("data", onData);

      this.obscuraProcess.on("error", (error) => {
        reject(new Error(`Failed to start Obscura service binary: ${error.message}`));
      });

      this.obscuraProcess.on("close", (code) => {
        console.error(`Obscura service process exited with code ${code}`);
        this.obscuraProcess = null;
        this.browser = null;
      });
    });
  }

  async stopObscuraService() {
    if (this.browser && this.browser.isConnected()) {
      await this.browser.disconnect();
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

process.on('SIGINT', async () => {
    console.error("Caught interrupt signal, shutting down...");
    await server.stopObscuraService();
    process.exit(0);
});