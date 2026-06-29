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
 * Tauri resources in tauri.conf.json will reference node_bin/${file} at runtime.
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { get } from "node:https";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const NODE_VERSION = process.env.DOWNLOAD_NODE_VERSION || "20.17.0";
const TARGET_DIR = resolve(ROOT, "node_bin");

const PLATFORMS = {
  win32: {
    arch: { x64: { url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`, file: "node.exe" } },
  },
  linux: {
    arch: { x64: { url: `https://nodejs.org/dist/v${NODE_VERSION}/linux-x64/node`, file: "node" } },
    arm64: { url: `https://nodejs.org/dist/v${NODE_VERSION}/linux-arm64/node`, file: "node" },
  },
  darwin: {
    arch: { x64: { url: `https://nodejs.org/dist/v${NODE_VERSION}/darwin-x64/node`, file: "node" }, arm64: { url: `https://nodejs.org/dist/v${NODE_VERSION}/darwin-arm64/node`, file: "node" } },
  },
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (existsSync(dest)) {
      console.log(`  ✓ Already exists: ${dest}`);
      resolve();
      return;
    }
    console.log(`  ⬇ Downloading ${url}`);
    const file = createWriteStream(dest);
    get(url, (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      // Follow redirects
      if (res.statusCode >= 300 && res.headers.location) {
        file.close();
        download(res.headers.location, dest).then(resolve, reject);
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

async function main() {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || process.arch;

  const plat = PLATFORMS[platform];
  if (!plat) {
    console.error(`Unsupported platform: ${platform}`);
    console.error(`Supported: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  const entry = plat.arch[arch];
  if (!entry) {
    console.error(`Unsupported arch: ${arch} on ${platform}`);
    process.exit(1);
  }

  const urls = Array.isArray(entry) ? entry : [entry];

  await mkdir(TARGET_DIR, { recursive: true });

  for (const { url, file } of urls) {
    const dest = resolve(TARGET_DIR, file);
    await download(url, dest);
    const { mode } = await stat(dest);
    // Make executable on Unix
    if (platform !== "win32" && !(mode & 0o111)) {
      await import("node:fs/promises").then((m) =>
        m.chmod(dest, 0o755)
      );
      console.log(`  ✓ Made executable: ${dest}`);
    }
  }

  console.log(`✅ Node.js ${NODE_VERSION} binary ready at ${TARGET_DIR}`);
}

main().catch((err) => {
  console.error("❌ download-node failed:", err.message);
  process.exit(1);
});