#!/usr/bin/env node
/**
 * Build wrapper for Tauri's beforeBuildCommand.
 *
 * Why this exists:
 *   - pnpm filters process.env when spawning subprocesses, so
 *     `VITE_VOICE_MODE=local pnpm exec vite build` does NOT actually set
 *     VITE_VOICE_MODE inside vite's transform phase.
 *   - The shell-style `KEY=VAL cmd` prefix doesn't work on Windows cmd.exe
 *     (Tauri's beforeBuildCommand runs in the system shell).
 *
 * Approach:
 *   - Take `--voice-mode <cloud|local>` as a script arg (pnpm forwards args
 *     after `--`, but `--voice-mode` directly works because we use a Node
 *     wrapper rather than pnpm exec).
 *   - Set process.env.VITE_VOICE_MODE before spawning vite.
 *   - Spawn vite via `cross-env TAURI_BUILD=1 ... pnpm exec vite build`,
 *     which works on POSIX and Windows alike (cross-env is a node shim).
 */

/**
 * Build wrapper for Tauri's beforeBuildCommand.
 *
 * Why this exists:
 *   - pnpm filters process.env when spawning subprocesses, so
 *     `VITE_VOICE_MODE=local pnpm exec vite build` does NOT actually set
 *     VITE_VOICE_MODE inside vite's transform phase.
 *   - The shell-style `KEY=VAL cmd` prefix doesn't work on Windows cmd.exe
 *     (Tauri's beforeBuildCommand runs in the system shell).
 *
 * Approach:
 *   - Take `--voice-mode <cloud|local>` as a script arg (pnpm forwards args
 *     after `--`, but `--voice-mode` directly works because we use a Node
 *     wrapper rather than pnpm exec).
 *   - Set process.env.VITE_VOICE_MODE before spawning vite, so vite.config.ts
 *     can read it via process.env and `define`-bake the value into the bundle.
 *   - Spawn vite via Node's spawnSync with shell:true. On Windows `pnpm` is
 *     a .cmd shim that requires shell resolution; without shell:true Node's
 *     spawnSync cannot find it and exits silently.
 *   - Cwd is derived from `import.meta.url` via `fileURLToPath` + `resolve`
 *     so it works on both POSIX and Windows paths (URL.pathname alone
 *     produces invalid `/D:/...` paths on Windows).
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let voiceMode = 'cloud';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--voice-mode' && i + 1 < args.length) {
    voiceMode = args[i + 1] === 'local' ? 'local' : 'cloud';
    break;
  }
}

const env = { ...process.env, VITE_VOICE_MODE: voiceMode, TAURI_BUILD: '1' };

function run(cmd, args, envOverride) {
  // shell:true because on Windows `pnpm` ships as `pnpm.cmd` and Node's
  // default spawn cannot find it without shell resolution. POSIX shells
  // handle this fine too.
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: resolve(__dirname, '..'),
    env: envOverride ?? env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('pnpm exec tsc --noEmit', [], env);
run('pnpm exec vite build', [], env);