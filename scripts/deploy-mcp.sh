#!/usr/bin/env bash
# scripts/deploy-mcp.sh — Deploy weavine-mcp to prod (47.79.43.80)
#
# Why this script exists:
#   - Local binary is glibc 2.34, prod (Alibaba Cloud Linux 3) is glibc 2.32.
#     Must build ON PROD to get a compatible binary.
#   - Deploy = build on prod + scp-edited main.rs + restart + verify.
#   - Each step is gated: build → restart → 6 spec tests.
#
# Usage:
#   scripts/deploy-mcp.sh                   # full deploy (build + restart + verify)
#   scripts/deploy-mcp.sh --verify-only     # just run the 6 tests against existing binary
#
# Required SSH: root@47.79.43.80 with /home/yf/.ssh/id_ed25519
# Required env on prod: /etc/weavine-mcp.env (WEAVINE_MCP_TRANSPORT=http, etc.)

set -euo pipefail

PROD=root@47.79.43.80
SSH_KEY=${SSH_KEY:-/home/yf/.ssh/id_ed25519}
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new $PROD"
SCP="scp -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

REPO_REMOTE=/www/weavine/repo
BIN_REMOTE=/www/weavine/weavine-mcp
BIN_BACKUP_BASE=/www/weavine/weavine-mcp

main() {
    if [ "${1:-}" = "--verify-only" ]; then
        verify
        return
    fi
    deploy
}

deploy() {
    local src_dir="$(dirname "$0")/../weavine-mcp/src"
    local ts_human=$(date +%Y%m%d-%H%M%S)

    # tar pipeline: only changed files + deletions (rsync not on prod).
    # `--listed-incremental` produces a snapshot file so the second run only
    # sends diffs; on a fresh prod, it transfers everything.
    local snapshot="/tmp/weavine-mcp.tar.snapshot"
    echo "═══ 1. push source diff to prod repo ═══"
    tar -czf - \
        --listed-incremental="$snapshot" \
        --exclude='target' --exclude='Cargo.lock' \
        -C "$src_dir" . \
      | $SSH "set -e
              cd $REPO_REMOTE/weavine-mcp/src
              # Only delete top-level files inside src/, NOT Cargo.toml above.
              find . -maxdepth 1 -type f -delete
              # Strip --listed-incremental output dir to avoid clobber; extract.
              tar -xzf - --listed-incremental=/dev/null"
    $SSH "cd $REPO_REMOTE && git status --short weavine-mcp/src/"

    echo
    echo "═══ 2. build on prod (glibc 2.32) ═══"
    $SSH "cd $REPO_REMOTE && cargo build --release -p weavine-mcp 2>&1 | tail -5"

    echo
    echo "═══ 3. backup current + install ═══"
    $SSH "
        set -e
        mv -f $BIN_REMOTE $BIN_BACKUP_BASE.\$ts_human.bak
        cp -f $REPO_REMOTE/target/release/weavine-mcp $BIN_REMOTE
        chmod 755 $BIN_REMOTE
        ls -la $BIN_REMOTE
    "

    echo
    echo "═══ 4. restart systemd unit ═══"
    $SSH "systemctl restart weavine-mcp && sleep 2 && systemctl is-active weavine-mcp"

    verify
}

verify() {
    echo
    echo "═══ 5. spec compliance tests ═══"

    echo "--- (a) POST initialize returns Mcp-Session-Id ---"
    local init
    init=$(curl -sS -i -m 5 -X POST https://weavine.financialagent.cc/mcp \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-verify","version":"0"}}}')
    echo "$init" | head -10
    local sid
    sid=$(echo "$init" | grep -i '^mcp-session-id:' | sed 's/.*: //;s/\r//')
    if [ -z "$sid" ]; then
        echo "✗ FAIL — no Mcp-Session-Id"; return 1
    fi
    echo "✓ session=$sid"

    echo
    echo "--- (b) GET /mcp with session + Accept SSE (expect 200, dump headers) ---"
    # SSE streams never close, so %{http_code} is never flushed. Instead dump
    # response headers to a file and grep for the status line.
    local hdrs; hdrs=$(mktemp)
    timeout 3 curl -sS -D "$hdrs" -o /dev/null \
        -X GET https://weavine.financialagent.cc/mcp \
        -H "Accept: text/event-stream" \
        -H "Mcp-Session-Id: $sid" 2>/dev/null || true
    # The CONNECT line is HTTP/1.1 200 (HTTPS tunnel), then HTTP/2 200 from upstream.
    # We want the upstream status — last "HTTP/" line in the dump.
    local get_status
    get_status=$(grep -E "^HTTP/" "$hdrs" | tail -1 | awk '{print $2}')
    rm -f "$hdrs"
    if [ "$get_status" = "200" ]; then
        echo "✓ GET → 200"
    else
        echo "✗ GET → $get_status (expected 200)"
        return 1
    fi

    echo
    echo "--- (c) GET without session (expect 400) ---"
    local no_sid
    no_sid=$(curl -sS -o /dev/null -w '%{http_code}' -X GET https://weavine.financialagent.cc/mcp \
        -H "Accept: text/event-stream")
    [ "$no_sid" = "400" ] && echo "✓ 400" || { echo "✗ $no_sid"; return 1; }

    echo
    echo "--- (d) DELETE session (expect 202) ---"
    local del_status
    del_status=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
        https://weavine.financialagent.cc/mcp \
        -H "Mcp-Session-Id: $sid")
    [ "$del_status" = "202" ] && echo "✓ 202" || { echo "✗ $del_status"; return 1; }

    echo
    echo "--- (e) GET after DELETE (expect 404) ---"
    local after_del
    after_del=$(curl -sS -o /dev/null -w '%{http_code}' -X GET \
        https://weavine.financialagent.cc/mcp \
        -H "Accept: text/event-stream" \
        -H "Mcp-Session-Id: $sid")
    [ "$after_del" = "404" ] && echo "✓ 404" || { echo "✗ $after_del"; return 1; }

    echo
    echo "═══ all checks passed ═══"
}

main "$@"