import { cpSync, existsSync, mkdirSync } from "fs";
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

console.log("Post-build done");
