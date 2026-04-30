const fs = require("fs");
const path = require("path");
const https = require("https");
const tar = require("tar");
const yauzl = require("yauzl");
const { pipeline } = require("stream");
const { promisify } = require("util");

const streamPipeline = promisify(pipeline);

const OBSCURA_VERSION = "v0.1.1";
const BASE_URL = `https://github.com/h4ckf0r0day/obscura/releases/download/${OBSCURA_VERSION}`;

const BIN_DIR = path.join(__dirname, "..", "bin");

function getPlatformInfo() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-macos" : "x86_64-macos";
  }
  if (platform === "linux") {
    return "x86_64-linux";
  }
  if (platform === "win32") {
    return "x86_64-windows";
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function expectedBinaryName() {
  return process.platform === "win32" ? "obscura.exe" : "obscura";
}

async function download(url, dest) {
  console.log(`Downloading Obscura binary from ${url}...`);

  return new Promise((resolve, reject) => {
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
            reject(
              new Error(
                `Failed to download file: ${response.statusCode} ${response.statusMessage}`,
              ),
            );
            return;
          }

          const file = fs.createWriteStream(dest);
          streamPipeline(response, file).then(resolve).catch(reject);
        })
        .on("error", reject);
    };

    request(url);
  });
}

async function extractZip(filePath, dest, binaryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) {
        reject(openError);
        return;
      }

      let found = false;
      zipfile.readEntry();

      zipfile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName) || path.basename(entry.fileName) !== binaryName) {
          zipfile.readEntry();
          return;
        }

        found = true;
        zipfile.openReadStream(entry, (streamError, readStream) => {
          if (streamError) {
            reject(streamError);
            return;
          }

          const outPath = path.join(dest, binaryName);
          streamPipeline(readStream, fs.createWriteStream(outPath))
            .then(() => resolve(outPath))
            .catch(reject);
        });
      });

      zipfile.on("end", () => {
        if (!found) {
          reject(new Error(`Archive did not contain ${binaryName}`));
        }
      });

      zipfile.on("error", reject);
    });
  });
}

async function extractTar(filePath, dest, binaryName) {
  const tempDir = path.join(dest, `.extract-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    await tar.x({
      file: filePath,
      cwd: tempDir,
      filter(entryPath) {
        return path.basename(entryPath) === binaryName;
      },
    });

    const candidates = [];
    const stack = [tempDir];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
        } else if (entry.name === binaryName) {
          candidates.push(entryPath);
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error(`Archive did not contain ${binaryName}`);
    }

    const finalPath = path.join(dest, binaryName);
    fs.copyFileSync(candidates[0], finalPath);
    return finalPath;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function extract(filePath, dest, binaryName) {
  console.log(`Extracting ${path.basename(filePath)}...`);
  if (filePath.endsWith(".zip")) {
    return await extractZip(filePath, dest, binaryName);
  }
  return await extractTar(filePath, dest, binaryName);
}

function validateBinary(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Obscura binary was not created at ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Obscura binary is invalid at ${filePath}`);
  }

  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o755);
  }
}

async function main() {
  const platform = getPlatformInfo();
  const isWindows = platform.includes("windows");
  const archiveType = isWindows ? ".zip" : ".tar.gz";
  const binaryName = expectedBinaryName();
  const url = `${BASE_URL}/obscura-${platform}${archiveType}`;
  const archivePath = path.join(__dirname, `obscura-archive${archiveType}`);

  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    await download(url, archivePath);
    const extractedBinaryPath = await extract(archivePath, BIN_DIR, binaryName);
    validateBinary(extractedBinaryPath);

    console.log(`Obscura binary successfully installed at ${extractedBinaryPath}`);
  } catch (error) {
    console.error("Failed to install Obscura binary:", error.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
}

main();
