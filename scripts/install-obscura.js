const fs = require('fs');
const path = require('path');
const https = require('https');
const tar = require('tar');
const yauzl = require('yauzl');
const { pipeline } = require('stream');
const { promisify } = require('util');

const streamPipeline = promisify(pipeline);

const OBSCURA_VERSION = 'v0.1.1'; // Pin the version for stability
const BASE_URL = `https://github.com/h4ckf0r0day/obscura/releases/download/${OBSCURA_VERSION}`;

const BIN_DIR = path.join(__dirname, '..', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'obscura');

function getPlatformInfo() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-macos' : 'x86_64-macos';
  }
  if (platform === 'linux') {
    return 'x86_64-linux';
  }
  if (platform === 'win32') {
    return 'x86_64-windows';
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

async function download(url, dest) {
  console.log(`Downloading Obscura binary from ${url}...`);
  const file = fs.createWriteStream(dest);
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirect
        https.get(response.headers.location, redirectedResponse => {
            streamPipeline(redirectedResponse, file)
                .then(resolve)
                .catch(reject);
        }).on('error', reject);
      } else if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
      } else {
        streamPipeline(response, file)
            .then(resolve)
            .catch(reject);
      }
    }).on('error', reject);
  });
}

async function extract(filePath, dest) {
  console.log(`Extracting ${path.basename(filePath)}...`);
  if (filePath.endsWith('.zip')) {
    // Windows
    return new Promise((resolve, reject) => {
      yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
        if (err) reject(err);
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            zipfile.readEntry();
          } else {
            // File entry
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) reject(err);
              const outPath = path.join(dest, path.basename(entry.fileName));
              const writeStream = fs.createWriteStream(outPath);
              readStream.pipe(writeStream);
              writeStream.on('finish', () => {
                resolve(outPath); // Assume the first file is the binary
              });
            });
          }
        });
      });
    });
  } else {
    // macOS / Linux
    await tar.x({
      file: filePath,
      cwd: dest,
    });
    return path.join(dest, 'obscura');
  }
}

async function main() {
  try {
    const platform = getPlatformInfo();
    const isWindows = platform.includes('windows');
    const archiveType = isWindows ? '.zip' : '.tar.gz';
    const binaryName = isWindows ? 'obscura.exe' : 'obscura';
    const finalBinaryPath = path.join(BIN_DIR, binaryName);

    const url = `${BASE_URL}/obscura-${platform}${archiveType}`;
    const archivePath = path.join(__dirname, `obscura-archive${archiveType}`);

    // Ensure bin directory exists
    if (!fs.existsSync(BIN_DIR)) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    await download(url, archivePath);
    const extractedBinaryPath = await extract(archivePath, BIN_DIR);

    // On Windows, the extracted file might not have the correct name
    if (isWindows && path.basename(extractedBinaryPath) !== binaryName) {
        fs.renameSync(extractedBinaryPath, finalBinaryPath);
    }
    
    // Ensure the binary is executable
    if (!isWindows) {
      fs.chmodSync(finalBinaryPath, '755');
    }

    // Clean up
    fs.unlinkSync(archivePath);

    console.log(`Obscura binary successfully installed at ${finalBinaryPath}`);

  } catch (error) {
    console.error('Failed to install Obscura binary:', error);
    process.exit(1);
  }
}

main();
