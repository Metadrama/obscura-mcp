const { spawn } = require("child_process");
const path = require("path");

// Test the MCP server by sending protocol messages
const server = spawn("node", [path.join(__dirname, "index.js"), "--transport", "stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: __dirname,
});

let output = "";
let isInitialized = false;
let toolsListed = false;

// Collect stderr for debugging
server.stderr.on("data", (data) => {
  console.error("SERVER:", data.toString());
});

// Listen for protocol responses
server.stdout.on("data", (data) => {
  output += data.toString();
  
  // Check for complete JSON-RPC messages
  try {
    const lines = output.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      
      const msg = JSON.parse(line);
      
      if (msg.result && msg.result.protocolVersion) {
        console.log("✓ Server initialized successfully");
        console.log("  Protocol version:", msg.result.protocolVersion);
        isInitialized = true;
        
        // Send tools/list after initialization
        setTimeout(() => {
          server.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }) + "\n");
        }, 100);
      }
      
      if (msg.result && msg.result.tools) {
        console.log("✓ Tools listed successfully");
        console.log("  Tools:", msg.result.tools.map(t => t.name).join(", "));
        toolsListed = true;
        
        // Shut down cleanly
        setTimeout(() => {
          server.kill("SIGTERM");
          process.exit(0);
        }, 500);
      }
      
      if (msg.error) {
        console.error("✗ Server error:", msg.error.message);
        server.kill("SIGTERM");
        process.exit(1);
      }
    }
    
    // Clear processed lines
    if (output.includes("\n")) {
      output = output.split("\n").slice(-1)[0];
    }
  } catch (e) {
    // Not JSON yet, keep buffering
  }
});

// Start by sending initialize
console.log("Testing MCP server...");
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

// Timeout after 10 seconds
setTimeout(() => {
  console.error("✗ Test timed out");
  server.kill("SIGTERM");
  process.exit(1);
}, 10000);

server.on("error", (err) => {
  console.error("✗ Failed to start server:", err.message);
  process.exit(1);
});

server.on("exit", (code) => {
  if (!isInitialized) {
    console.error("✗ Server did not initialize");
    process.exit(1);
  }
  if (!toolsListed) {
    console.error("✗ Server did not list tools");
    process.exit(1);
  }
});
