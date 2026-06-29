#!/usr/bin/env node
/**
 * Download portable Node.js binary for the current platform.
 *
 * Outputs to project-root/node_bin/ — consumed by Tauri resources config.
 *
 * Usage:
 *   node scripts/download-node.mjs                  # auto-detect platform
 *   node scripts/download-node.mjs win32 x64         # explicit platform/arch
 *   DOWNLOAD_NODE_VERSION=20.17.0 node scripts/download-node.mjs  # specific version
 *
 * Platform handling:
 *   - Windows: downloads single node.exe (provided by Node.js as standalone binary)
 *   - Linux/macOS: downloads tar.gz and extracts the bin/node binary
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, stat, rm } from "node:fs/promises";
import { get } from "node:https";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const NODE_VERSION = process.env.DOWNLOAD_NODE_VERSION || "20.17.0";
const TARGET_DIR = resolve(ROOT, "node_bin");
const EXTRACT_DIR = resolve(TARGET_DIR, ".extract");

const MIN_SIZE = 1024 * 1024; // 1MB — any valid binary is much larger

async function downloadFile(url, dest) {
  console.log(`  ⬇ Downloading ${url}`);
  const file = createWriteStream(dest);
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode >= 400) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      if (res.statusCode >= 300 && res.headers.location) {
        file.close();
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      reject(err);
    });
  });
}

async function extractTarGz(tarball, outputDir, binaryName) {
  console.log(`  📦 Extracting ${binaryName} from tarball...`);
  // Use tar command (available on Linux/macOS)
  const result = spawnSync("tar", [
    "-xzf", tarball,
    "--strip-components=2",  // node-v20.17.0-linux-x64/bin/node → bin/node
    "--directory", outputDir,
    `*/bin/${binaryName}`,
  ], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`tar extraction failed (exit ${result.status})`);
  }
}

function getDistUrl(platform, arch) {
  if (platform === "win32" && arch === "x64") {
    return {
      url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
      file: "node.exe",
      type: "exe",
    };
  }

  // Linux/macOS use tar.gz distributions
  let osName;
  if (platform === "linux") {
    osName = "linux";
  } else if (platform === "darwin") {
    osName = "darwin";
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${osName}-${arch}.tar.gz`;
  return { url, file: "node", type: "targz" };
}

async function downloadWithRetry(entry) {
  const dest = resolve(TARGET_DIR, entry.file);

  // Check if existing file is valid
  if (existsSync(dest)) {
    const { size } = await stat(dest);
    if (size >= MIN_SIZE) {
      console.log(`  ✓ Already exists: ${dest} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      return dest;
    }
    console.log(`  ⚠ Removing corrupt file: ${dest} (${size} bytes)`);
    await rm(dest, { force: true });
  }

  if (entry.type === "exe") {
    await downloadFile(entry.url, dest);
  } else if (entry.type === "targz") {
    // Download tarball to temp location
    await mkdir(EXTRACT_DIR, { recursive: true });
    const tarball = resolve(EXTRACT_DIR, `node-${NODE_VERSION}.tar.gz`);
    await downloadFile(entry.url, tarball);
    await extractTarGz(tarball, EXTRACT_DIR, entry.file);
    // Move binary to target
    const extracted = resolve(EXTRACT_DIR, entry.file);
    await import("node:fs/promises").then((m) =>
      m.rename(extracted, dest)
    );
    // Cleanup
    await rm(EXTRACT_DIR, { recursive: true, force: true });
  }

  // Verify
  const { size } = await stat(dest);
  if (size < MIN_SIZE) {
    await rm(dest, { force: true });
    throw new Error(`Downloaded binary too small: ${size} bytes (expected >= ${MIN_SIZE})`);
  }

  // Make executable on Unix
  if (entry.type !== "exe") {
    await import("node:fs/promises").then((m) =>
      m.chmod(dest, 0o755)
    );
    console.log(`  ✓ Made executable: ${dest}`);
  }

  return dest;
}

async function main() {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || process.arch;

  console.log(`🎯 Target: ${platform} ${arch}, Node.js v${NODE_VERSION}`);

  const entry = getDistUrl(platform, arch);
  console.log(`  URL: ${entry.url}`);

  await mkdir(TARGET_DIR, { recursive: true });

  const dest = await downloadWithRetry(entry);

  const { size } = await stat(dest);
  // Quick smoke test
  const { stdout } = spawnSync(dest, ["--version"], { encoding: "utf8", timeout: 5000 });
  const ver = stdout?.trim() || "unknown";
  console.log(`  ✓ Version: ${ver}`);
  console.log(`  ✓ Size: ${(size / 1024 / 1024).toFixed(1)} MB`);

  // Check executable bit on Unix
  if (platform !== "win32") {
    const { mode } = await stat(dest);
    if (!(mode & 0o111)) {
      console.log(`  ⚠ Fixing executable bit`);
      await import("node:fs/promises").then((m) => m.chmod(dest, 0o755));
    }
  }

  console.log(`✅ Node.js ${ver} binary ready at ${dest}`);
}

main().catch((err) => {
  console.error("❌ download-node failed:", err.message);
  process.exit(1);
});