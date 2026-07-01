/**
 * File-based diagnostics for desktop standalone builds.
 *
 * Writes to <data_dir>/diag.log — the data_dir is derived from DATABASE_URL,
 * which the Tauri spawner sets to `file:<data_dir>/dev.db`.
 *
 * Node.js built-ins are loaded via dynamic require so the module can be
 * imported from edge runtimes (instrumentation hook, RSC stubs) without
 * triggering webpack "UnhandledSchemeError" on the `node:` URI scheme.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire: ((m: string) => any) | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).require;
  } catch {
    return null;
  }
})();

function resolveDataDir(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return null;
  const path = url.slice(5);
  if (path.startsWith("//")) return null; // not a local file
  if (!nodeRequire) return null;
  const { dirname } = nodeRequire("node:path") as typeof import("node:path");
  return dirname(path);
}

function timestamp(): string {
  return new Date().toISOString();
}

let _initialized = false;
let _logPath: string | null = null;

function ensureLogFile(): string | null {
  if (_initialized) return _logPath;
  _initialized = true;
  const dir = resolveDataDir();
  if (!dir) {
    _logPath = null;
    return null;
  }
  if (!nodeRequire) return null;
  try {
    const { mkdirSync } = nodeRequire("node:fs") as typeof import("node:fs");
    mkdirSync(dir, { recursive: true });
    _logPath = dir + "/diag.log";
  } catch {
    _logPath = null;
  }
  return _logPath;
}

export function diag(...args: unknown[]): void {
  const line = `[${timestamp()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
  if (typeof process !== "undefined" && process.stderr) {
    process.stderr.write(`[PRM-DIAG] ${line}`);
  }
  const logPath = ensureLogFile();
  if (logPath && nodeRequire) {
    try {
      const { appendFileSync } = nodeRequire("node:fs") as typeof import("node:fs");
      appendFileSync(logPath, line);
    } catch {
      // Best-effort
    }
  }
}