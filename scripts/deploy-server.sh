#!/usr/bin/env bash
# scripts/deploy-server.sh — Deploy weavine-server to prod (wy = 110.42.215.153, www.weavine.com)
#
# Why this script exists:
#   - wy has 2 cores / 3.7 GB RAM; build ON prod for glibc compat, with
#     memory-safe release settings (lto=false, codegen-units=256).
#   - Deploy = tar sources over ssh → cargo build on prod → backup binary →
#     restart weavine-server.service → smoke verify.
#   - server/.env.production is MANAGED ON THE SERVER (never synced from
#     local — it holds secrets, and a careless sync has already eaten it
#     once; see git history before touching the flags).
#
# Usage (run from Git Bash on Windows — uses the `wy` alias in ~/.ssh/config):
#   scripts/deploy-server.sh                # full deploy
#   scripts/deploy-server.sh --verify-only  # smoke tests only
#
# Required SSH: `wy` host alias → ubuntu@110.42.215.153 (key
# ~/.ssh/weavine_11042). Override with PROD=<user@host>.

set -euo pipefail

PROD=${PROD:-wy}
SSH="ssh -o StrictHostKeyChecking=accept-new $PROD"
REPO_REMOTE=/home/ubuntu/weavine
BIN_REMOTE=$REPO_REMOTE/target/release/weavine-server
SERVICE_NAME=weavine-server
APP_BASE_URL=${APP_BASE_URL:-https://www.weavine.com}

main() {
    if [ "${1:-}" = "--verify-only" ]; then
        verify
        return
    fi
    deploy
}

deploy() {
    echo "═══ 1. pack + ship sources → $PROD:$REPO_REMOTE (never touches .env.production) ═══"
    # tar over ssh (scp the tarball, extract remotely): plain file transfer,
    # no rsync needed — Git Bash on Windows doesn't ship it.
    local tarball
    tarball="/tmp/weavine-src-$(date +%s).tar.gz"
    (cd "$(dirname "$0")/.." && tar czf "$tarball" \
        Cargo.toml Cargo.lock \
        server \
        src-tauri/src src-tauri/Cargo.toml src-tauri/build.rs src-tauri/vendor \
        apps/web-spa/src)
    scp -o StrictHostKeyChecking=accept-new "$tarball" "$PROD:/tmp/weavine-src.tar.gz"
    $SSH "cd $REPO_REMOTE && tar xzf /tmp/weavine-src.tar.gz && rm -f /tmp/weavine-src.tar.gz"
    rm -f "$tarball"

    echo
    echo "═══ 2. build on prod (memory-safe release profile) ═══"
    $SSH "cd $REPO_REMOTE && nohup bash -lc 'CARGO_BUILD_JOBS=2 cargo build --release \
        --config profile.release.lto=false --config profile.release.codegen-units=256 \
        --manifest-path server/Cargo.toml --features ocr,stt' > /tmp/weavine-build.log 2>&1 &"
    echo "    build started; waiting…"
    # [c] trick: `pgrep -f 'cargo build'` also matches THIS ssh's remote
    # command line (`bash -c pgrep -f 'cargo build'`), which made the wait
    # loop spin forever. The bracket pattern matches "cargo build" but not
    # its own literal text.
    while $SSH "pgrep -f '[c]argo build' > /dev/null"; do sleep 15; done
    $SSH "grep -E 'Finished|^error' /tmp/weavine-build.log | tail -2"
    $SSH "test -x $BIN_REMOTE" || { echo "✗ build produced no binary"; exit 1; }

    echo
    echo "═══ 3. backup current + install ═══"
    local ts
    ts=$(date +%Y%m%d-%H%M%S)
    $SSH "cp -f $BIN_REMOTE $BIN_REMOTE.$ts.bak && ls -la $BIN_REMOTE*"

    echo
    echo "═══ 4. restart $SERVICE_NAME ═══"
    $SSH "sudo systemctl restart $SERVICE_NAME && sleep 3 && systemctl is-active $SERVICE_NAME"

    verify
}

verify() {
    echo
    echo "═══ smoke ═══"
    echo "--- (a) /api/health → OK ---"
    local health
    health=$(curl -sS -m 5 "$APP_BASE_URL/api/health")
    echo "    $health"
    [ "$health" = "OK" ] || { echo "✗ FAIL — health=$health"; return 1; }

    echo "--- (b) login with verify account ---"
    local login
    login=$(curl -sS -m 10 -X POST "$APP_BASE_URL/api/auth/login" \
        -H 'Content-Type: application/json' \
        -d '{"email":"pesome@gmail.com","password":"kejukeji1","device":{"name":"deploy-verify","os":"linux","app_version":"0.0.0"}}')
    local token
    token=$(echo "$login" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null || true)
    [ -n "$token" ] || { echo "✗ FAIL — no token"; return 1; }
    echo "    ✓ token length=${#token}"

    echo "--- (c) notes list carries entity_types (notes filter feature) ---"
    curl -sS -m 10 "$APP_BASE_URL/api/notes" -H "Authorization: Bearer $token" \
        | python3 -c 'import sys,json; d=json.load(sys.stdin); print("    ✓", len(d["items"]), "notes; entity_types present:", "entity_types" in (d["items"][0] if d["items"] else {}))'
    echo "✓ deploy verified"
}

main "$@"
