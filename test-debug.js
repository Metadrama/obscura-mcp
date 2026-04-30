#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

class DebugTest {
  constructor() {
    this.browser = null;
    this.obscuraProcess = null;
  }

  async start() {
    const obscuraPath = path.join(
      process.env.APPDATA,
      "npm",
      "node_modules",
      "mcp-obscura",
      "bin",
      "obscura.exe"
    );
    
    console.error("[DEBUG] Using Obscura binary:", obscuraPath);
    
    this.obscuraProcess = spawn(obscuraPath, ["serve"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    return new Promise((resolve, reject) => {
      const onData = async (chunk) => {
        const output = chunk.toString("utf8");
        console.error("[DEBUG]", output.trim());
        const match = output.match(/CDP server: (ws:\/\/.*)/);
        if (match && match[1]) {
          const endpoint = match[1];
          try {
            this.browser = await puppeteer.connect({
              browserWSEndpoint: endpoint,
              defaultViewport: null,
            });
            
            console.error("[SUCCESS] Connected to Obscura");
            this.obscuraProcess.stderr.removeListener("data", onData);
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      };

      this.obscuraProcess.stdout.on("data", onData);
      this.obscuraProcess.stderr.on("data", onData);
    });
  }

  async testRawCDP() {
    console.error("\n[TEST] Creating target via raw CDP...");
    
    try {
      // Create a new blank target
      const newTargetResponse = await this.browser._connection.send("Target.createTarget", {
        url: "about:blank"
      });
      const targetId = newTargetResponse.targetId;
      console.error("[DEBUG] Created target:", targetId);
      
      // Wait for target to be ready
      await new Promise(r => setTimeout(r, 500));
      
      // Create a session
      const session = await this.browser._connection.createSession({ targetId });
      console.error("[DEBUG] Created session");
      
      // Enable domains
      try {
        await session.send("Page.enable", {});
        console.error("[DEBUG] Enabled Page domain");
      } catch (e) {
        console.error("[DEBUG] Page.enable error (expected):", e.message);
      }
      
      try {
        await session.send("Runtime.enable", {});
        console.error("[DEBUG] Enabled Runtime domain");
      } catch (e) {
        console.error("[DEBUG] Runtime.enable error (expected):", e.message);
      }
      
      // Navigate to google.com
      console.error("[DEBUG] Navigating to google.com...");
      await session.send("Page.navigate", { url: "https://google.com" });
      
      // Wait for page to load
      console.error("[DEBUG] Waiting 5 seconds for page load...");
      await new Promise(r => setTimeout(r, 5000));
      
      // Test the new DOM-based extraction logic
      console.error("[DEBUG] Testing new DOM extraction logic...");
      
      try {
        console.error("[DEBUG] Calling DOM.getDocument...");
        const docResult = await session.send("DOM.getDocument", {});
        
        if (docResult?.root?.nodeId === undefined) {
          throw new Error("No root node");
        }
        
        console.error("[DEBUG] Got root node:", docResult.root.nodeId);
        const rootNodeId = docResult.root.nodeId;
        
        // Find HTML element - skip DOCTYPE (nodeType 10)
        let htmlNodeId = null;
        if (docResult.root.children && docResult.root.children.length > 0) {
          for (const child of docResult.root.children) {
            console.error("[DEBUG] Checking child - nodeName:", child.nodeName, "nodeType:", child.nodeType);
            // Skip DOCTYPE (nodeType 10)
            if (child.nodeType !== 10 && child.nodeName.toLowerCase() === "html") {
              htmlNodeId = child.nodeId;
              console.error("[DEBUG] Found HTML node:", htmlNodeId);
              break;
            }
          }
        }
        
        if (htmlNodeId === null || htmlNodeId === undefined) {
          htmlNodeId = rootNodeId;
          console.error("[DEBUG] Using root as htmlNodeId:", htmlNodeId);
        }
        
        // Get HTML
        console.error("[DEBUG] Calling DOM.getOuterHTML for nodeId:", htmlNodeId);
        const outerHTML = await session.send("DOM.getOuterHTML", { nodeId: htmlNodeId });
        const html = outerHTML?.outerHTML || "";
        console.error("[DEBUG] Got HTML, length:", html.length);
        if (html.length > 0) {
          console.error("[CONTENT] First 1000 chars of HTML:\n", html.substring(0, 1000));
        } else {
          console.error("[WARNING] HTML is empty");
        }
        
      } catch (extractErr) {
        console.error("[ERROR] Extraction failed:", extractErr.message);
      }
      
      // Close target
      console.error("[DEBUG] Closing target...");
      await this.browser._connection.send("Target.closeTarget", { targetId });
      
    } catch (error) {
      console.error("[ERROR]", error);
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.disconnect();
    }
    if (this.obscuraProcess) {
      this.obscuraProcess.kill();
    }
  }
}

const test = new DebugTest();
test.start()
  .then(() => test.testRawCDP())
  .then(() => test.cleanup())
  .catch(err => {
    console.error("[FATAL ERROR]", err);
    test.cleanup();
    process.exit(1);
  });
