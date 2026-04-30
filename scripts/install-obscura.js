#!/usr/bin/env node

/**
 * Obscura binary installer.
 *
 * The binary is cached at ~/.obscura/bin/ (permanent, survives npm upgrades)
 * and linked into the local node_modules bin/ dir at install time.
 *
 * npm install flow:
 *   1. Check ~/.obscura/bin/obscura — cache hit? Copy to local bin/ → instant.
 *   2. Cache miss? Download binary to ~/.obscura/bin/, then copy to local bin/.
 *
 * At runtime (index.js):
 *   1. Check local bin/ → hit? Use it.
 *   2. Check ~/.obscura/bin/ → hit? Copy to local bin/.
 *   3. Miss? Download to cache, copy to local.
 *
 * Cache survives npm upgrades, reinstalls, and version changes.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const tar = require("tar");
const yauzl = require("yauzl");
const { pipeline } = require("stream");
const { promisify } = require("util");

const streamPipeline = promisify(pipeline);

const OBSCURA_VERSION = "v0.1.1";
const BASE_URL = `https://github.com/h4ckf0r0day/obscura/releases/download/${OBSCURA_VERSION}`;

function cacheDir() {
  return path.join(os.homedir(), ".obscura", "bin");
}

function localBinDir() {
  return path.join(__dirname, "..", "bin");
}

function getPlatformInfo() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin") return arch === "arm64" ? "aarch64-macos" : "x86_64-macos";
  if (platform === "linux") return "x86_64-linux";
  if (platform === "win32") return "x86_64-windows";
  throw new Error(`Unsupported platform: ${platform}`);
}

function expectedBinaryName() {
  return process.platform === "win32" ? "obscura.exe" : "obscura";
}

function say(line) {
  process.stderr.write(line + "\n");
}

// Copy binary from cache into local bin/. Creates local bin/ if needed.
function ensureLocalLink(cachePath, localPath) {
  const localDir = path.dirname(localPath);
  fs.mkdirSync(localDir, { recursive: true });
  fs.copyFileSync(cachePath, localPath);
  if (process.platform !== "win32") fs.chmodSync(localPath, 0o755);
}

async function ensureBinary() {
  const binaryName = expectedBinaryName();
  const localPath = path.join(localBinDir(), binaryName);
  const cachePath = path.join(cacheDir(), binaryName);
  const platform = getPlatformInfo();

  // 1. Check local bin/
  if (fs.existsSync(localPath)) {
    const stat = fs.statSync(localPath);
    if (stat.isFile() && stat.size > 0) return localPath;
  }

  // 2. Check persistent cache ~/.obscura/bin/
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    if (stat.isFile() && stat.size > 0) {
      ensureLocalLink(cachePath, localPath);
      return localPath;
    }
  }

  // 3. Cache miss — download to cache, then link to local
  const isWindows = platform.includes("windows");
  const archiveType = isWindows ? ".zip" : ".tar.gz";
  const url = `${BASE_URL}/obscura-${platform}${archiveType}`;
  const archivePath = path.join(os.tmpdir(), `obscura-archive${archiveType}`);

  say("Downloading Obscura headless browser (~80 MB)...");

  if (fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true });

  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    await download(url, archivePath);
    const extracted = await extract(archivePath, cacheDir(), binaryName);
    validateBinary(extracted);
    ensureLocalLink(extracted, localPath);
    say(`Obscura binary installed at ${localPath}`);
    return localPath;
  } finally {
    if (fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true });
  }
}

async function download(url, dest) {
  const size = await getContentLength(url);
  const sizeLabel = size ? ` (${(size / 1024 / 1024).toFixed(1)} MB)` : "";
  say(`Downloading${sizeLabel}...`);

  return new Promise((resolve, reject) => {
    const PROGRESS_INTERVAL = 3000;
    let lastProgress = Date.now();
    let bytesReceived = 0;

    const request = (currentUrl) => {
      https
        .get(currentUrl, (response) => {
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume();
            request(new URL(response.headers.location, currentUrl).toString());
            return;
          }

          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
            return;
          }

          response.on("data", (chunk) => {
            bytesReceived += chunk.length;
            const now = Date.now();
            if (now - lastProgress >= PROGRESS_INTERVAL) {
              lastProgress = now;
              if (size) {
                const pct = Math.min(99, Math.round((bytesReceived / size) * 100));
                say(`  ${pct}% (${(bytesReceived / 1024 / 1024).toFixed(1)}/${(size / 1024 / 1024).toFixed(1)} MB)`);
              } else {
                say(`  ${(bytesReceived / 1024 / 1024).toFixed(1)} MB downloaded...`);
              }
            }
          });

          const file = fs.createWriteStream(dest);
          streamPipeline(response, file).then(resolve).catch(reject);
        })
        .on("error", reject);
    };

    request(url);
  });
}

function getContentLength(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: "HEAD" }, (res) => {
      const len = parseInt(res.headers["content-length"] || "0", 10);
      res.resume();
      resolve(len > 0 ? len : null);
    });
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function extractZip(filePath, dest, binaryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) { reject(openError); return; }
      let found = false;
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName) || path.basename(entry.fileName) !== binaryName) {
          zipfile.readEntry(); return;
        }
        found = true;
        zipfile.openReadStream(entry, (streamError, readStream) => {
          if (streamError) { reject(streamError); return; }
          const outPath = path.join(dest, binaryName);
          streamPipeline(readStream, fs.createWriteStream(outPath)).then(() => resolve(outPath)).catch(reject);
        });
      });
      zipfile.on("end", () => { if (!found) reject(new Error(`Archive missing ${binaryName}`)); });
      zipfile.on("error", reject);
    });
  });
}

async function extractTar(filePath, dest, binaryName) {
  const tempDir = path.join(dest, `.extract-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    await tar.x({ file: filePath, cwd: tempDir, filter: (p) => path.basename(p) === binaryName });
    const stack = [tempDir];
    let found;
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const ep = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(ep);
        else if (entry.name === binaryName) found = ep;
      }
    }
    if (!found) throw new Error(`Archive missing ${binaryName}`);
    const finalPath = path.join(dest, binaryName);
    fs.copyFileSync(found, finalPath);
    return finalPath;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function extract(filePath, dest, binaryName) {
  say(`Extracting ${path.basename(filePath)}...`);
  return filePath.endsWith(".zip")
    ? await extractZip(filePath, dest, binaryName)
    : await extractTar(filePath, dest, binaryName);
}

function validateBinary(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Binary not found at ${filePath}`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Invalid binary at ${filePath}`);
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o755);
}

// ─── CLI entry (postinstall) ───
if (require.main === module) {
  ensureBinary().catch((err) => {
    say(`Failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { ensureBinary, expectedBinaryName };
