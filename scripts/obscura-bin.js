#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const binaryName = process.platform === 'win32' ? 'obscura.exe' : 'obscura';
const binPath = path.join(__dirname, '..', 'bin', binaryName);

if (!fs.existsSync(binPath)) {
  console.error(`Error: Obscura binary not found at ${binPath}`);
  console.error('Please ensure the postinstall script has run successfully.');
  process.exit(1);
}

const args = process.argv.slice(2);

const child = spawn(binPath, args, {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (code !== null) {
    process.exit(code);
  } else if (signal) {
    // If killed by signal, exit with 1 (or map signals appropriately if needed)
    process.exit(1);
  }
});

child.on('error', (err) => {
  console.error(`Failed to start subprocess: ${err.message}`);
  process.exit(1);
});
