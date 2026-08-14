#!/usr/bin/env bash
# scripts/deploy-server.sh — Deploy weavine-server to prod (47.79.43.80)
#
# Why this script exists:
#   - Local binary is glibc 2.34, prod (Alibaba Cloud Linux 3) is glibc 2.32.
#     Must build ON PROD to get a compatible binary.
#   - Deploy = git pull on prod → cargo build → backup old binary →
#     install new → restart systemd unit → health/smoke verify.
#   - Mirrors deploy-mcp.sh structure for consistency.
#
# Usage:
#   scripts/deploy-server.sh                # full deploy
#   scripts/deploy-server.sh --verify-only  # smoke tests only
#
# Required SSH: root@47.79.43.80 with /home/yf/.ssh/id_ed25519

set -euo pipefail

PROD=root@47.79.43.80
SSH_KEY=${SSH_KEY:-/home/yf/.ssh/id_ed25519}
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new $PROD"

REPO_REMOTE=/www/weavine/repo
BIN_REMOTE=/www/weavine/weavine-server
SERVICE_NAME=weavine-web

main() {
    if [ "${1:-}" = "--verify-only" ]; then
        verify
        return
    fi
    deploy
}

deploy() {
    local ts_human
    ts_human=$(date +%Y%m%d-%H%M%S)

    echo "═══ 1. pull latest on prod (cd $REPO_REMOTE && git pull --ff-only) ═══"
    $SSH "cd $REPO_REMOTE && git fetch origin && git log -1 --oneline && git reset --hard origin/main"

    echo
    echo "═══ 2. ensure runtime deps (ffmpeg) + whisper model ═══"
    # ffmpeg is the audio-decode fallback for /api/voice/recognize (symphonia 0.5
    # lacks a released opus codec; weavine-voice.rs shells out to ffmpeg on
    # webm/opus). Required on prod, not optional.
    $SSH "
        set -e
        if ! command -v ffmpeg >/dev/null 2>&1; then
            echo 'installing ffmpeg...'
            (yum install -y epel-release 2>/dev/null || dnf install -y epel-release 2>/dev/null) || true
            (dnf install -y ffmpeg 2>/dev/null || yum install -y ffmpeg 2>/dev/null) \
                || { echo 'ffmpeg install failed — see deploy docs'; exit 1; }
        fi
        ffmpeg -version 2>&1 | head -1
        # whisper tiny model (~75 MB, Apache-2.0). Idempotent.
        bash $REPO_REMOTE/scripts/install-whisper-model.sh
    "

    echo
    echo "═══ 3. pin prod-compatible deps + build on prod (glibc 2.32) ═══"
    # ocr + stt features enable cloud OCR (Tesseract via leptess) and cloud STT
    # (whisper.cpp tiny). Without --features, these endpoints are not compiled
    # in and /api/cards/extract + /api/voice/recognize return 404.
    $SSH "cd $REPO_REMOTE && cargo update -p notify-rust --precise 4.11.0 2>&1 | tail -3 && cargo build --release --locked --manifest-path server/Cargo.toml --features ocr,stt 2>&1 | tail -15"

    echo
    echo "═══ 5. backup current + install ═══"
    $SSH "
        set -e
        [ -f $BIN_REMOTE ] && mv -f $BIN_REMOTE $BIN_REMOTE.$ts_human.bak
        cp -f $REPO_REMOTE/target/release/weavine-server $BIN_REMOTE
        chmod 755 $BIN_REMOTE
        ls -la $BIN_REMOTE $BIN_REMOTE.$ts_human.bak 2>/dev/null || ls -la $BIN_REMOTE
    "

    echo
    echo "═══ 6. restart systemd unit $SERVICE_NAME ═══"
    $SSH "systemctl restart $SERVICE_NAME && sleep 3 && systemctl is-active $SERVICE_NAME"

    verify
}

verify() {
    echo
    echo "═══ 6. smoke tests ═══"

    echo "--- (a) /api/health → OK ---"
    local health
    health=$(curl -sS -m 5 https://weavine.financialagent.cc/api/health)
    echo "    $health"
    [ "$health" = "OK" ] || { echo "✗ FAIL — health=$health"; return 1; }

    echo "--- (b) login with seeded account → 200 + access_token ---"
    local login
    login=$(curl -sS -m 10 -X POST https://weavine.financialagent.cc/api/auth/login \
        -H 'Content-Type: application/json' \
        -d "{\"email\":\"pesome@gmail.com\",\"password\":\"kejukeji1\",\"device\":{\"name\":\"deploy-verify\",\"os\":\"linux\",\"app_version\":\"0.0.0\"}}")
    local at
    at=$(echo "$login" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null || true)
    if [ -z "$at" ]; then
        echo "✗ FAIL — login no token: $(echo $login | head -c 200)"; return 1
    fi
    echo "    ✓ access_token length=${#at}"

    echo "--- (c) create event with reminder_lead_minutes → server derives reminder ---"
    local start_at
    start_at=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)
    local ev
    ev=$(curl -sS -m 10 -X POST https://weavine.financialagent.cc/api/events \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $at" \
        -d "{\"title\":\"deploy-verify\",\"type\":\"会议\",\"start_at\":\"$start_at\",\"reminder_lead_minutes\":15}")
    local ev_id
    ev_id=$(echo "$ev" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)
    if [ -z "$ev_id" ]; then
        echo "✗ FAIL — create event: $(echo $ev | head -c 200)"; return 1
    fi
    echo "    ✓ event_id=$ev_id"

    local rem
    rem=$(curl -sS -m 10 -X GET "https://weavine.financialagent.cc/api/reminders?event_id=$ev_id" \
        -H "Authorization: Bearer $at")
    local rem_count
    rem_count=$(echo "$rem" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "0")
    if [ "$rem_count" != "1" ]; then
        echo "✗ FAIL — expected 1 reminder, got $rem_count: $(echo $rem | head -c 200)"; return 1
    fi
    echo "    ✓ reminder derived from event (1 row)"

    echo "--- (d) cleanup: dismiss reminder + delete event ---"
    local rem_id
    rem_id=$(echo "$rem" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])' 2>/dev/null)
    curl -sS -m 5 -X POST "https://weavine.financialagent.cc/api/reminders/$rem_id/dismiss" \
        -H "Authorization: Bearer $at" >/dev/null
    curl -sS -m 5 -X DELETE "https://weavine.financialagent.cc/api/events/$ev_id" \
        -H "Authorization: Bearer $at" >/dev/null
    echo "    ✓ cleaned up"

    echo
    echo "═══ all checks passed ═══"
}

main "$@"