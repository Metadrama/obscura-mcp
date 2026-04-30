const { spawn } = require("child_process");
const path = require("path");

const server = spawn("node", [path.join(__dirname, "index.js"), "--transport", "stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: __dirname,
  env: {
    ...process.env,
    OBSCURA_PATH: path.join(__dirname, "bin", process.platform === "win32" ? "obscura.exe" : "obscura"),
  },
});

let output = "";
let initialized = false;
let toolsListed = false;

server.stderr.on("data", (data) => {
  const msg = data.toString().trim();
  if (msg) {
    console.error("SERVER:", msg);
  }
});

server.stdout.on("data", (data) => {
  output += data.toString();

  const lines = output.split("\n");
  output = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);

    if (msg.result?.protocolVersion && !initialized) {
      initialized = true;
      console.log("Server initialized successfully");
      server.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }) + "\n");
      server.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }) + "\n");
    }

    if (msg.result?.tools) {
      const names = msg.result.tools.map((tool) => tool.name);
      for (const expected of ["browse_url"]) {
        if (!names.includes(expected)) {
          throw new Error(`Missing expected tool: ${expected}`);
        }
      }
      toolsListed = true;
      console.log(`Tools listed successfully: ${names.join(", ")}`);
      server.kill("SIGTERM");
    }

    if (msg.error) {
      throw new Error(msg.error.message);
    }
  }
});

server.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0",
    },
  },
}) + "\n");

setTimeout(() => {
  console.error("Test timed out");
  server.kill("SIGTERM");
  process.exit(1);
}, 15000);

server.on("error", (err) => {
  console.error(`Failed to start server: ${err.message}`);
  process.exit(1);
});

server.on("exit", () => {
  if (!initialized || !toolsListed) {
    console.error("Server did not complete MCP initialization and tool listing");
    process.exit(1);
  }
  process.exit(0);
});
