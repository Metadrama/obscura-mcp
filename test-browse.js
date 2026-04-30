const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const binaryName = process.platform === "win32" ? "obscura.exe" : "obscura";
const binPath = path.join(__dirname, "bin", binaryName);

// Test the MCP server by actually browsing google.com
const server = spawn("node", [path.join(__dirname, "index.js"), "--transport", "stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: __dirname,
  env: {
    ...process.env,
    OBSCURA_PATH: binPath,
  },
});

let output = "";
let requestId = 2;
let initialized = false;

// Collect stderr for debugging
server.stderr.on("data", (data) => {
  const msg = data.toString().trim();
  if (msg) console.error("[SERVER]", msg);
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
      
      if (msg.result && msg.result.protocolVersion && !initialized) {
        console.log("[INFO] Server initialized");
        initialized = true;
        
        // Send browse_url request for google.com
        setTimeout(() => {
          console.log("[INFO] Calling browse_url on google.com...");
          server.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            id: requestId++,
            method: "tools/call",
            params: {
              name: "browse_url",
              arguments: {
                url: "https://www.google.com",
                dump: "text",
              },
            },
          }) + "\n");
        }, 500);
      }
      
      if (msg.result && msg.result.content && msg.result.content[0]) {
        const responseText = msg.result.content[0].text;
        console.log("\n" + "=".repeat(80));
        console.log("RESPONSE FROM google.com (first 1000 chars):");
        console.log("=".repeat(80));
        console.log(responseText.substring(0, 1000));
        console.log("=".repeat(80));
        
        // Shut down cleanly
        setTimeout(() => {
          server.kill("SIGTERM");
          process.exit(0);
        }, 500);
      }
      
      if (msg.error) {
        console.error("[ERROR]", msg.error.message);
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
console.log("[INFO] Starting MCP server test...");
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

// Timeout after 30 seconds
setTimeout(() => {
  console.error("[ERROR] Test timed out");
  server.kill("SIGTERM");
  process.exit(1);
}, 30000);

server.on("error", (err) => {
  console.error("[ERROR] Failed to start server:", err.message);
  process.exit(1);
});
