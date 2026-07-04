# AGENTS.md — AI agent guidelines for this repo

## Production server (weavine-web)

Production runs at `https://ai.financialagent.cc` (Alibaba Cloud Linux 3, glibc **2.32**).

### SSH
```
ssh root@47.79.43.80
```

### Server paths (CRITICAL — read before deploying)
- `/www/weavine/repo/` — git clone of this repo (NOT the same as local working tree)
- `/www/weavine/repo/src-tauri/target/release/weavine-web` — build output
- `/www/weavine/weavine-web` — production binary (managed by systemd)
- `/www/weavine/spa/` — current SPA bundle
- `/www/weavine/spa.bak/` — previous SPA bundle (rollback target)
- `/www/weavine/weavine-web.db` (+ `.db-shm`, `.db-wal`) — SQLite (auto-migrates on service start)
- `/etc/systemd/system/weavine-web.service` — systemd unit

### Server Rust toolchain
- Default toolchain is **rustc 1.85.0** — TOO OLD for current `time@0.3.51` (requires 1.88+)
- Required toolchain: **rustc 1.88.0** (installed via `rustup toolchain install 1.88.0`)
- Use `cargo +1.88.0 ...` to pin it
- `rustc 1.74.0` was corrupt on this server (recovered; do not uninstall)

### 🚨 HARD RULES (forgot these, broke prod today)

1. **NEVER build Rust locally and scp to server.** Local toolchain is Ubuntu glibc 2.34+; server has glibc 2.32. Local builds produce `GLIBC_2.33/2.34` symbols that don't exist on server → binary crashes immediately on startup.

2. **NEVER use `rustup override set stable`** in `src-tauri/` (or anywhere). Stable is rustc 1.96.0 which also breaks glibc. Verify with `rustup show` before any cargo build.

3. **NEVER `rustup toolchain uninstall 1.74.0`** — that broke local cargo state for no reason.

4. **ALWAYS do server-side builds** for backend changes. Pull code, build on server, swap binary in place, restart systemd.

5. **Service state matters**: if you break the binary, `systemctl restart weavine-web` will retry-loop (RestartSec=3s) and emit GLIBC errors in journal. Roll back IMMEDIATELY — service is down until you do.

### Backend deploy (Rust binary changes)

```bash
# 1. SSH in
ssh root@47.79.43.80

# 2. Pull latest code on server
cd /www/weavine/repo
git fetch
git checkout <branch>
git pull

# 3. Build with the right toolchain
cd src-tauri
cargo +1.88.0 build --release --bin weavine-web --no-default-features

# 4. Verify the binary is compatible BEFORE swapping
ldd target/release/weavine-web | grep -i glibc
# Must be empty. If "GLIBC_2.33 not found" appears → STOP, do not proceed.

# 5. Backup current + swap
cp /www/weavine/weavine-web /www/weavine/weavine-web.$(date +%s).bak
mv target/release/weavine-web /www/weavine/weavine-web
chmod +x /www/weavine/weavine-web

# 6. Restart (migration runs on startup)
systemctl restart weavine-web
sleep 3
systemctl status weavine-web --no-pager
journalctl -u weavine-web --since "30 seconds ago" --no-pager | tail -20

# 7. Smoke test
curl -s https://ai.financialagent.cc/api/health
curl -s 'https://ai.financialagent.cc/api/projects/stages?template=general'
```

If GLIBC error appears in journal after restart: rollback
```bash
mv /www/weavine/weavine-web /www/weavine/weavine-web.broken-$(date +%s)
ls /www/weavine/weavine-web.*.bak | tail -1 | xargs -I{} mv {} /www/weavine/weavine-web
chmod +x /www/weavine/weavine-web
systemctl restart weavine-web
```

### Frontend deploy (SPA bundle changes)

Build happens locally, then scp to server (glibc doesn't apply — JS bundle, not native):

```bash
# 1. Build locally
cd apps/web-spa
pnpm tsc --noEmit                                    # type check
VITE_API_BASE='' pnpm run build                      # builds dist/
ls -la dist/                                         # verify output

# 2. Tar + scp
cd dist
tar -czf /tmp/spa.tar.gz .
scp /tmp/spa.tar.gz root@47.79.43.80:/tmp/spa.tar.gz

# 3. Atomic swap on server
ssh root@47.79.43.80 bash <<'REMOTE'
set -e
rm -rf /www/weavine/spa.new
mkdir -p /www/weavine/spa.new
cd /www/weavine/spa.new
tar xzf /tmp/spa.tar.gz
rm -rf /www/weavine/spa.bak
mv /www/weavine/spa /www/weavine/spa.bak
mv /www/weavine/spa.new /www/weavine/spa
rm -f /tmp/spa.tar.gz
REMOTE
```

Note: `VITE_API_BASE=''` (empty) so the SPA calls same-origin `/api/*` — the Rust server is what serves both API and SPA static files.

### Data migrations

All migrations live in `src-tauri/src/migration.rs`. They run **automatically on service start**. Migrations are idempotent (count-gated) so restart-loops are safe. Always check that the SQLite file at `/www/weavine/weavine-web.db` has reasonable size after deploy (a few MB is normal, GBs would mean runaway growth).

To inspect live data:
```bash
ssh root@47.79.43.80
sqlite3 /www/weavine/weavine-web.db ".tables"
sqlite3 /www/weavine/weavine-web.db "SELECT template, stage, COUNT(*) FROM Project GROUP BY template, stage"
```

### What this server does NOT have

- No Tauri (this is the web build only — `weavine-web` binary, no `tauri::command` deps at runtime)
- No staging/dev environment — production is the only live system
- No PM2 / Next.js — there's a separate `deploy-prod.sh` for an unrelated Next.js project at `/opt/prm/`. Ignore that script; it's for a different app.

### Lessons learned (do not repeat)

- 2026-07-04: locally-built Rust binary (rustc 1.96.0) crashed on server (glibc 2.32). Service went down for ~30 seconds during rollback. User was angry. Server-side build with `cargo +1.88.0` is the correct path.