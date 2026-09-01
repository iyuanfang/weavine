#!/usr/bin/env bash
# scripts/install-whisper-model.sh — download the whisper.cpp ggml model used
# by the server-side STT endpoint (POST /api/voice/recognize).
#
# The server's `voice` handler reads `WHISPER_MODEL` (defaults to
# /var/lib/weavine/models/ggml-tiny.bin) and returns 503 if the file is
# missing. This script makes the operator-side install a one-liner.
#
# Usage:
#   scripts/install-whisper-model.sh                # install to default path
#   DEST=/opt/weavine/models/ggml-tiny.bin \
#     scripts/install-whisper-model.sh              # install elsewhere
#   MODEL=ggml-base.bin scripts/install-whisper-model.sh   # bigger model
#
# Default model: ggml-tiny.bin (~75 MB, Apache-2.0, 5–10× realtime on CPU,
# good Mandarin accuracy). Swap for `ggml-base.bin` or `ggml-small.bin`
# if you need better WER and can afford ~2× the model size + ~3–5× CPU.

set -euo pipefail

DEST=${DEST:-/var/lib/weavine/models/ggml-tiny.bin}
MODEL=${MODEL:-ggml-tiny.bin}
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}"

log()  { echo -e "\033[0;32m[whisper]\033[0m $*"; }
warn() { echo -e "\033[1;33m[whisper]\033[0m $*"; }
err()  { echo -e "\033[0;31m[whisper]\033[0m $*" >&2; }

if [ -f "$DEST" ]; then
    log "model already present at $DEST (size=$(stat -c %s "$DEST" 2>/dev/null || stat -f %z "$DEST") bytes) — nothing to do."
    log "delete it and re-run this script to refresh."
    exit 0
fi

mkdir -p "$(dirname "$DEST")"

log "downloading $MODEL → $DEST"
log "  source: $URL"
if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 15 -o "$DEST.tmp" "$URL"
elif command -v wget >/dev/null 2>&1; then
    wget -O "$DEST.tmp" "$URL"
else
    err "neither curl nor wget found — install one and retry"
    exit 1
fi

mv -f "$DEST.tmp" "$DEST"
chmod 644 "$DEST"

size=$(stat -c %s "$DEST" 2>/dev/null || stat -f %z "$DEST")
if [ "$size" -lt 1000000 ]; then
    err "downloaded file is suspiciously small ($size bytes) — aborting"
    rm -f "$DEST"
    exit 1
fi

log "✓ done. $DEST ($size bytes)"
log "restart the server to pick it up: systemctl restart weavine-web"
log "to use a different model, set WHISPER_MODEL before starting the server."