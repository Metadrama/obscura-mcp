const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { execSync } = require("child_process");

// Configuration
const OBSCURA_PATH = process.env.OBSCURA_PATH || "obscura";

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
          const cmdArgs = ["fetch", args.url, "--dump", args.dump || "html"];
          if (args.stealth !== false) cmdArgs.push("--stealth");

          // Use Obscura's native fetch CLI for maximum reliability and speed
          const output = execSync(`"${OBSCURA_PATH}" ${cmdArgs.join(" ")}`, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"], // Ignore stderr to avoid Protocol error noise
          });

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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Obscura MCP Server running on stdio");
  }
}

const server = new ObscuraServer();
server.run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
