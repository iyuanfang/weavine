import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const standaloneNm = join(root, ".next", "standalone", "node_modules");

const copyIfExists = (src, dest) => {
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    console.log(`  engine: ${src} -> ${dest}`);
  }
};

const prismaClient = join(root, "node_modules", ".prisma", "client");
const prismaClientDest = join(standaloneNm, ".prisma", "client");
copyIfExists(prismaClient, prismaClientDest);

const prismaEngines = join(root, "node_modules", "@prisma", "engines");
const prismaEnginesDest = join(standaloneNm, "@prisma", "engines");
copyIfExists(prismaEngines, prismaEnginesDest);

// Strip schema-engine binary (~18MB) — not needed at runtime, only for migrations
if (existsSync(prismaEnginesDest)) {
  for (const file of readdirSync(prismaEnginesDest)) {
    if (file.startsWith("schema-engine")) {
      const fpath = join(prismaEnginesDest, file);
      rmSync(fpath, { recursive: true, force: true });
      console.log(`  removed: ${fpath} (schema-engine, not needed at runtime)`);
    }
  }
}

// Also clean up schema-engine from .prisma/client if present
if (existsSync(prismaClientDest)) {
  for (const file of readdirSync(prismaClientDest)) {
    if (file.startsWith("schema-engine")) {
      const fpath = join(prismaClientDest, file);
      rmSync(fpath, { recursive: true, force: true });
      console.log(`  removed: ${fpath} (schema-engine)`);
    }
  }
}

console.log("Post-build done");
