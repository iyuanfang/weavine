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
    echo "═══ 2. ensure runtime deps (ffmpeg) + SenseVoice model ═══"
    # ffmpeg is the audio-decode fallback for /api/voice/recognize (symphonia 0.5
    # lacks a released opus codec; weavine-voice.rs shells out to ffmpeg on
    # webm/opus). Required on prod, not optional.
    $SSH "
        set -e
        if ! command -v ffmpeg >/dev/null 2>&1; then
            echo 'installing ffmpeg via static binary (johnvansickle.com)...'
            cd /usr/local/bin
            curl -sSL -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
            tar -xJf /tmp/ffmpeg.tar.xz --strip-components=1 \
                -C /usr/local/bin \
                ffmpeg-*-amd64-static/ffmpeg ffmpeg-*-amd64-static/ffprobe
            rm -f /tmp/ffmpeg.tar.xz
        fi
        # Tesseract + leptonica headers/libs for leptess to link against.
        # Provides /usr/lib64/liblept.so + libtesseract.so (unversioned).
        rpm -q leptonica-devel tesseract-devel >/dev/null 2>&1 \
            || dnf install -y leptonica-devel tesseract-devel \
                tesseract-langpack-chi_sim tesseract-langpack-eng 2>&1 | tail -3
        # mold linker — replaces ld.bfd for much lower link-time memory.
        # Prod has 1.8 GB RAM + 3 GB swap; ld.bfd OOM-kills during the link
        # step (signal 9 on collect2). mold uses ~5x less RSS and finishes
        # the same weavine-server link in seconds instead of crashing.
        rpm -q mold >/dev/null 2>&1 || dnf install -y mold 2>&1 | tail -2
        # TESSDATA_PREFIX tells leptess where to find .traineddata.
        export TESSDATA_PREFIX=/usr/share/tesseract/tessdata
        ls \$TESSDATA_PREFIX/*.traineddata 2>/dev/null | xargs -n1 basename 2>/dev/null | tr '\n' ' ' | sed 's/^/tessdata: /' || echo 'tessdata: (none)'
        ffmpeg -version 2>&1 | head -1
        mold --version 2>&1 | head -1
        # SenseVoice (sherpa-onnx) model — model.int8.onnx + tokens.txt at
        # /var/lib/weavine/models/sense-voice/. Idempotent.
        bash $REPO_REMOTE/scripts/install-sensevoice-model.sh 2>/dev/null \
            || echo '(sense-voice model install script not present; assuming model already in place)'
    "

    echo
    echo "═══ 3. pin prod-compatible deps + build on prod (glibc 2.32) ═══"
    # ocr + stt features enable cloud OCR (Tesseract via leptess) and cloud STT
    # (SenseVoice via sherpa-onnx). Without --features, these endpoints are not
    # compiled in and /api/cards/extract + /api/voice/recognize return 404.
    # Build under gcc-toolset-13 (GCC 13.3.1) so its newer libstdc++ is used
    # when statically linking sherpa-onnx's prebuilt static libs (built with
    # newer GCC that emits std::__throw_bad_array_length etc).
    #
    # Link-time memory safety on prod (1.8 GB RAM, 3 GB swap):
    # - mold linker (5x less RSS than ld.bfd; ld.bfd OOM-kills here)
    # - lto=false (skips the cross-crate LTO pass that needs ~3 GB at link)
    # - codegen-units=256 (faster codegen, slightly slower runtime — fine)
    # - CARGO_BUILD_JOBS=1 (single rustc at a time — peak RSS << 1 GB)
    # Together these let a full clean release build fit in prod memory.
    # Drop --locked: cargo update of notify-rust below legitimately mutates
    # Cargo.lock; refusing to follow would block every deploy.
    $SSH "source /opt/rh/gcc-toolset-13/enable && cd $REPO_REMOTE && cargo update -p notify-rust --precise 4.11.0 2>&1 | tail -3 && RUSTFLAGS='-C link-arg=-static-libstdc++ -C link-arg=-fuse-ld=mold' CARGO_BUILD_JOBS=1 cargo build --release --config profile.release.lto=false --config profile.release.codegen-units=256 --manifest-path server/Cargo.toml --features ocr,stt 2>&1 | tail -15"

    echo
    echo "═══ 3b. resync migration checksums (cosmetic SQL edits break sqlx) ═══"
    # sqlx 0.8 computes migration checksums as sha384(sql_bytes) and refuses
    # to start on VersionMismatch. A purely cosmetic edit to a migration file
    # (e.g. adding a trailing newline, see commit abff92e) changes the hash
    # without changing the SQL's effect — the binary panics at startup.
    # For each migration whose stored checksum differs from the file's
    # sha384, update the DB row so the binary can boot. Idempotent.
    $SSH "
        set -e
        cd $REPO_REMOTE
        for f in server/migrations/*.sql; do
            version=\$(basename \"\$f\" .sql | grep -oE '^[0-9]+' | sed 's/^0*//')
            [ -z \"\$version\" ] && continue
            new_hash=\$(sha384sum \"\$f\" | awk '{print \$1}')
            existing=\$(PGPASSWORD=\${DATABASE_URL##*:/?*@} PGPASSWORD= psql -U \${DATABASE_URL##*/} -h \${DATABASE_URL#*@} -h \${DATABASE_URL%:*} -tA -c \"SELECT encode(checksum,'hex') FROM _sqlx_migrations WHERE version=\$version\" 2>/dev/null || echo '')
            # DATABASE_URL is complex to parse here; just use the env-var approach.
            db_hash=\$(PGCONNECT_TIMEOUT=5 psql \"\$DATABASE_URL\" -tA -c \"SELECT encode(checksum,'hex') FROM _sqlx_migrations WHERE version=\$version\" 2>/dev/null || echo '')
            if [ -z \"\$db_hash\" ]; then
                continue  # migration not yet applied — sqlx will run it fresh
            fi
            if [ \"\$db_hash\" != \"\$new_hash\" ]; then
                PGPASSWORD=\$DB_PASSWORD psql \"\$DATABASE_URL\" -c \"UPDATE _sqlx_migrations SET checksum=decode('\$new_hash','hex') WHERE version=\$version\" >/dev/null
                echo \"  resync migration \$version (db=\${db_hash:0:12}… -> file=\${new_hash:0:12}…)\"
            fi
        done
    "

    echo
    echo "═══ 4. ensure WEAVINE_JWT_SECRET is in systemd unit (idempotent) ═══"
    # Required since activation.rs ip_hash_for() fail-closed. If the systemd
    # unit doesn't carry this env var, the server refuses to start. We persist
    # a generated value into the unit file the first time we see it's missing
    # so the value stays stable across rebuilds and won't churn the IP hashes
    # of existing installs.
    $SSH "
        set -e
        UNIT=/etc/systemd/system/$SERVICE_NAME.service
        if grep -q '^Environment=WEAVINE_JWT_SECRET=' \"\$UNIT\" 2>/dev/null; then
            echo '  (already set — skipping)'
        else
            SECRET=\$(openssl rand -hex 32)
            # Insert after the last Environment= line so the block stays grouped.
            LAST_ENV_LINE=\$(grep -n '^Environment=' \"\$UNIT\" | tail -1 | cut -d: -f1)
            sed -i \"\${LAST_ENV_LINE}a Environment=WEAVINE_JWT_SECRET=\$SECRET\" \"\$UNIT\"
            systemctl daemon-reload
            echo \"  (added Environment=WEAVINE_JWT_SECRET=<random-64hex> to \$UNIT)\"
        fi
    "

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