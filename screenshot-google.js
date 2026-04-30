const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const obscuraPath = path.join(process.env.APPDATA, "npm", "node_modules", "mcp-obscura", "bin", "obscura.exe");
const screenshotPath = path.join(__dirname, "google-screenshot.png");

console.log("[INFO] Using Obscura at:", obscuraPath);
console.log("[INFO] Will save screenshot to:", screenshotPath);

const server = spawn(obscuraPath, ["serve"], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let connected = false;
let startTime = Date.now();
const timeout = setTimeout(() => {
  console.error("[ERROR] Timeout waiting for Obscura to start");
  server.kill();
  process.exit(1);
}, 30000);

server.stdout.on("data", async (data) => {
  const output = data.toString();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.error(`[Obscura ${elapsed}s]`, output.trim());
  
  if (!connected && output.includes("CDP server:")) {
    connected = true;
    clearTimeout(timeout);
    
    const match = output.match(/CDP server: (ws:\/\/[^\s]+)/);
    if (match) {
      const endpoint = match[1];
      console.log("[INFO] Connecting to", endpoint);
      
      try {
        const puppeteer = require("puppeteer-core");
        const browser = await puppeteer.connect({
          browserWSEndpoint: endpoint,
          defaultViewport: null,
        });
        
        console.log("[INFO] Connected! Taking screenshot of google.com...");
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 1024 });
        
        console.log("[INFO] Navigating to https://www.google.com...");
        // Use simpler navigation to avoid Audits.enable error
        await Promise.race([
          page.goto("https://www.google.com", { waitUntil: "domContentLoaded", timeout: 30000 }),
          new Promise(resolve => setTimeout(resolve, 5000)) // 5 second backup
        ]);
        
        console.log("[INFO] Page loaded, saving screenshot...");
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log("[SUCCESS] Screenshot saved!");
        console.log("[SUCCESS] Path:", screenshotPath);
        
        await page.close();
        await browser.disconnect();
        server.kill();
        process.exit(0);
      } catch (error) {
        console.error("[ERROR]", error.message);
        server.kill();
        process.exit(1);
      }
    }
  }
});

server.stderr.on("data", (data) => {
  const output = data.toString();
  console.error("[Obscura stderr]", output.trim());
});

server.on("error", (err) => {
  console.error("[ERROR] Failed to start Obscura:", err.message);
  process.exit(1);
});

server.on("close", (code) => {
  if (!connected) {
    console.error("[ERROR] Obscura exited with code", code);
    process.exit(1);
  }
});
