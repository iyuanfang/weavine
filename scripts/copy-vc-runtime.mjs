#!/usr/bin/env node
/**
 * Locate Microsoft Visual C++ runtime DLLs and copy them into
 * src-tauri/vc-runtime so the Tauri bundle includes them.
 *
 * This is the established workaround for "missing vcruntime140.dll"
 * crashes when running a Tauri MSI on a fresh Windows install.
 * (Until Tauri ships the upstream `bundle.windows.bundleVCRuntime`
 * option in a stable release we depend on.)
 *
 * Strategy:
 *   1. Run `vswhere.exe -latest -property installationPath` to find VS
 *   2. Look in `<VS>/VC/Redist/MSVC/<version>/x64/Microsoft.VC*.CRT/`
 *   3. Copy vcruntime140.dll, vcruntime140_1.dll, msvcp140.dll
 *
 * On non-Windows hosts this script is a no-op (the Linux/macOS bundles
 * do not need these DLLs).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST = resolve(ROOT, "src-tauri/vc-runtime");

const REQUIRED_DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

function findVswhere() {
  const candidates = [
    "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe",
    "C:/Program Files/Microsoft Visual Studio/Installer/vswhere.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function locateRedistDir() {
  if (process.platform !== "win32") return null;

  const vswhere = findVswhere();
  if (!vswhere) {
    console.warn("  ⚠ vswhere.exe not found — cannot locate VC redist");
    return null;
  }

  const r = spawnSync(vswhere, ["-latest", "-property", "installationPath"], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.warn(`  ⚠ vswhere failed: ${r.stderr || r.stdout}`);
    return null;
  }
  const vsPath = r.stdout.trim();
  if (!vsPath) return null;

  const redistBase = join(vsPath, "VC", "Redist", "MSVC");
  if (!existsSync(redistBase)) return null;

  const versions = readdirSync(redistBase)
    .filter((n) => statSync(join(redistBase, n)).isDirectory())
    .sort()
    .reverse();
  if (versions.length === 0) return null;

  const x64 = join(redistBase, versions[0], "x64");
  if (!existsSync(x64)) return null;

  for (const sub of readdirSync(x64)) {
    const candidate = join(x64, sub);
    if (!statSync(candidate).isDirectory()) continue;
    if (REQUIRED_DLLS.every((dll) => existsSync(join(candidate, dll)))) {
      return candidate;
    }
  }
  return null;
}

function main() {
  if (process.platform !== "win32") {
    console.log("⏭ copy-vc-runtime: skipped (non-Windows host)");
    return;
  }

  console.log("📦 Locating Visual C++ runtime DLLs...");

  const redist = locateRedistDir();
  if (!redist) {
    console.warn("  ⚠ Could not locate VC redist — MSI may fail to start on systems without VC++ runtime");
    return;
  }

  console.log(`  Found redist at: ${redist}`);
  mkdirSync(DEST, { recursive: true });

  let copied = 0;
  for (const dll of REQUIRED_DLLS) {
    const src = join(redist, dll);
    if (!existsSync(src)) {
      console.warn(`  ⚠ Missing: ${dll}`);
      continue;
    }
    copyFileSync(src, join(DEST, dll));
    copied++;
  }

  console.log(`  ✓ Copied ${copied}/${REQUIRED_DLLS.length} DLLs to ${DEST}`);
}

main().catch((err) => {
  console.error("❌ copy-vc-runtime failed:", err);
  process.exit(1);
});