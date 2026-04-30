#!/usr/bin/env node
/**
 * Postinstall — must ALWAYS exit fast (< 1 second).
 * npm on Windows buffers all lifecycle output until the script exits,
 * so any download here creates a silent cursor. The binary is
 * downloaded on first use via `obscura-mcp` command (real terminal).
 *
 * This script only copies from the persistent cache if it exists.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const binaryName = process.platform === "win32" ? "obscura.exe" : "obscura";
const cachePath = path.join(os.homedir(), ".obscura", "bin", binaryName);
const localPath = path.join(__dirname, "..", "bin", binaryName);

if (fs.existsSync(cachePath)) {
  const stat = fs.statSync(cachePath);
  if (stat.isFile() && stat.size > 0) {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.copyFileSync(cachePath, localPath);
    if (process.platform !== "win32") fs.chmodSync(localPath, 0o755);
    // One line to stderr — npm can buffer it, fine, it's a single line
    process.stderr.write(`Obscura binary ready (cached)\n`);
    process.exit(0);
  }
}

// Cache is cold. No download — that happens on first `obscura-mcp` run.
process.stderr.write(
  `Obscura binary will be downloaded on first use. Run: obscura-mcp\n`,
);
