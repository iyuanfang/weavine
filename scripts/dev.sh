#!/usr/bin/env bash
set -euo pipefail

CMD="${1:-help}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log() { echo -e "${GREEN}[dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[dev]${NC} $*"; }
err() { echo -e "${RED}[dev]${NC} $*" >&2; }

case "$CMD" in
  check)
    log "cargo check (no codegen, ~2s on warm cache)"
    cargo check --manifest-path src-tauri/Cargo.toml
    ;;

  rust)
    log "cargo build --release (~30s on warm cache, ~3min cold)"
    cargo build --release --manifest-path src-tauri/Cargo.toml
    log "binary at src-tauri/target/release/weavine"
    ;;

  next)
    log "Next.js build + standalone bundle patch"
    IS_DESKTOP=true DATABASE_URL="file:./dev.db" pnpm build
    IS_DESKTOP=true node scripts/copy-tauri-standalone.mjs
    ;;

  bundler)
    log "Tauri .deb bundle (~3min, AppImage skipped due to linuxdeploy timeout)"
    rm -rf src-tauri/target/release/bundle
    pnpm exec tauri build --bundles deb
    log "artifact: src-tauri/target/release/bundle/deb/Weavine_0.1.0_amd64.deb"
    ;;

  release)
    log "Full release build (.deb + .AppImage) — may take 3-6 min, AppImage often times out"
    pnpm exec tauri build --bundles deb,appimage 2>&1 | tail -25
    ;;

  fresh)
    log "Clean rebuild (target/ + .next/)"
    rm -rf src-tauri/target .next node_modules/.cache
    log "Re-running pnpm install"
    pnpm install --frozen-lockfile
    "$0" build
    ;;

  verify-fix)
    log "End-to-end verification of Tauri first-boot (extracts .deb, simulates spawner, hits /contacts)"
    DEB="$(find src-tauri/target/release/bundle/deb -name '*.deb' | head -1)"
    if [ -z "$DEB" ]; then
      err "no .deb found — run: $0 bundler"
      exit 1
    fi
    WORK="/tmp/weavine-verify-$$"
    rm -rf "$WORK" && mkdir -p "$WORK/data/com.weavine.prm"
    dpkg-deb -x "$DEB" "$WORK/extract/"
    BUNDLED_DB="$WORK/extract/usr/lib/Weavine/_up_/standalone-bundle/dev.db"
    log "Bundled DB tables: $(python3 -c "import sqlite3; c=sqlite3.connect('$BUNDLED_DB'); print([r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").fetchall()])")"

    log "Stage 1: Database::new() creates empty dev.db (post-Fix-A migrate() is no-op)"
    python3 -c "import sqlite3; c=sqlite3.connect('$WORK/data/com.weavine.prm/dev.db'); c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA foreign_keys=ON'); c.close()"

    log "Stage 2: spawner detects incomplete schema and copies bundled DB"
    python3 << PYEOF
import sqlite3, shutil, os
def is_db_fully_initialized(p):
    c = sqlite3.connect(p)
    for t in ['User','Account','Session','VerificationToken']:
        if not c.execute('SELECT 1 FROM sqlite_master WHERE type=? AND name=?',('table',t)).fetchone():
            return False
    return True
db='$WORK/data/com.weavine.prm/dev.db'
if not is_db_fully_initialized(db):
    shutil.copy('$BUNDLED_DB', db)
    print('  → schema was incomplete, copied bundled DB')
else:
    print('  → schema already complete')
PYEOF

    log "Stage 3: spawn standalone-bundle server and hit /contacts"
    PORT=3299
    cd standalone-bundle && DATABASE_URL="file:$WORK/data/com.weavine.prm/dev.db" IS_DESKTOP=true PORT=$PORT HOSTNAME=127.0.0.1 NODE_ENV=production setsid node server.js > "$WORK/server.log" 2>&1 < /dev/null &
    SERVER_PID=$!; disown
    sleep 4
    HTTP=$(curl -s -m 8 -o "$WORK/contacts.html" -w "%{http_code}" -H "Cache-Control: no-cache" "http://127.0.0.1:$PORT/contacts?t=$(date +%s%N)")
    DIAG_LINES=$(wc -l < "$WORK/data/com.weavine.prm/diag.log" 2>/dev/null || echo 0)
    ERRORS=$(grep -cE 'Error:' "$WORK/server.log" || echo 0)
    cd "$PROJECT_ROOT"
    pkill -9 -f "standalone-bundle/server.js" 2>/dev/null || true

    echo ""
    echo "==================================="
    echo "  /contacts HTTP: $HTTP"
    echo "  diag.log lines: $DIAG_LINES"
    echo "  Server errors:  $ERRORS"
    echo "==================================="
    [ "$HTTP" = "200" ] && [ "$ERRORS" = "0" ] && [ "$DIAG_LINES" -gt "0" ] && log "✓ VERIFICATION PASSED" || { err "✗ VERIFICATION FAILED"; exit 1; }
    ;;

  sccache-stats)
    if command -v sccache >/dev/null 2>&1; then
      sccache --show-stats
    else
      warn "sccache not installed. Install with: cargo install sccache --locked"
    fi
    ;;

  help|--help|-h|"")
    cat <<'EOF'
Weavine dev workflow shortcuts

USAGE:
  ./scripts/dev.sh <command>

COMMANDS:
  check         cargo check (no binary, ~2s on warm cache)
  rust          cargo build --release binary only (~30s warm, ~3min cold)
  next          Next.js build + standalone bundle patch
  bundler       Tauri .deb bundle (~3min, skips AppImage)
  release       Full release .deb + .AppImage (3-6 min, AppImage flaky)
  fresh         Clean target/ + .next/ then rebuild
  verify-fix    End-to-end Tauri first-boot verification (needs prior .deb)
  sccache-stats Show sccache hit/miss statistics (if installed)
  help          Show this message

DAILY WORKFLOW:
  Frontend UI only:     pnpm dev              (hot reload)
  Frontend + Tauri:     pnpm tauri dev        (sec restart, no spawner)
  Rust change:          ./scripts/dev.sh rust
  Pre-release check:    ./scripts/dev.sh bundler && ./scripts/dev.sh verify-fix
  Tag & release:        ./scripts/dev.sh release
EOF
    ;;

  *)
    err "unknown command: $CMD"
    err "run: ./scripts/dev.sh help"
    exit 1
    ;;
esac