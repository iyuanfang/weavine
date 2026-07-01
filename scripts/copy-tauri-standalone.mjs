#!/usr/bin/env node
/**
 * Post-build: patch Next.js standalone output for Tauri bundling.
 *
 * Next.js standalone output (.next/standalone) contains:
 *   - server.js              (entry point)
 *   - .next/server/          (server bundle)
 *   - node_modules/          (only the deps Next.js detected)
 *
 * Missing things that Tauri needs:
 *   - .next/static/          (client bundles — for hydration)
 *   - public/                (static assets)
 *   - Prisma client binary   (SQLite native engine)
 *
 * This script copies those into the standalone output so Tauri can bundle
 * everything as a single resource directory.
 */

import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

async function main() {
  const standalone = resolve(ROOT, ".next/standalone");
  if (!existsSync(standalone)) {
    throw new Error(`.next/standalone not found. Run \`pnpm build\` first.`);
  }

  console.log("📦 Patching Next.js standalone output for Tauri...");

  const staticSrc = resolve(ROOT, ".next/static");
  const staticDst = resolve(standalone, ".next/static");
  if (existsSync(staticSrc)) {
    await cp(staticSrc, staticDst, { recursive: true });
    console.log("  ✓ .next/static/");
  }

  const publicSrc = resolve(ROOT, "public");
  const publicDst = resolve(standalone, "public");
  if (existsSync(publicSrc)) {
    await cp(publicSrc, publicDst, { recursive: true });
    console.log("  ✓ public/");
  }

  const prismaClientSrc = resolve(ROOT, "node_modules/.prisma/client");
  const prismaClientDst = resolve(standalone, "node_modules/.prisma/client");
  if (existsSync(prismaClientSrc)) {
    await cp(prismaClientSrc, prismaClientDst, { recursive: true });
    console.log("  ✓ node_modules/.prisma/client/");
  }

  const prismaEnginesSrc = resolve(ROOT, "node_modules/@prisma/engines");
  const prismaEnginesDst = resolve(standalone, "node_modules/@prisma/engines");
  if (existsSync(prismaEnginesSrc)) {
    await cp(prismaEnginesSrc, prismaEnginesDst, { recursive: true });
    console.log("  ✓ node_modules/@prisma/engines/");
  }

  // Copy entire standalone to a clean directory for Tauri resource bundling
  const bundleDir = resolve(ROOT, "standalone-bundle");
  if (existsSync(bundleDir)) {
    await rm(bundleDir, { recursive: true });
  }
  await cp(standalone, bundleDir, { recursive: true });
  console.log("  ✓ standalone-bundle/ (for Tauri resource bundling)");

  // Bundle the pre-initialized dev.db. `prisma db push` writes to
  // prisma/dev.db (relative to schema location), not the project root,
  // so we read from there directly.
  const prismaDir = resolve(ROOT, "prisma");
  const devDbSrc = resolve(prismaDir, "dev.db");
  const devDbDst = resolve(bundleDir, "dev.db");
  if (existsSync(devDbSrc)) {
    await cp(devDbSrc, devDbDst);
    console.log("  ✓ dev.db (pre-initialized database)");
  }

  console.log("✅ Standalone output ready for Tauri bundling");
}

main().catch((err) => {
  console.error("❌ Postbuild failed:", err);
  process.exit(1);
});
