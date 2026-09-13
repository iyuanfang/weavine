#!/usr/bin/env bash
set -euo pipefail

# scripts/deploy-web.sh — Deploy weavine web-spa (PWA) to prod
# (wy = ubuntu@110.42.215.153, https://www.weavine.com)
#
# Why this script exists:
#   - The web-spa is served as static files by nginx on wy, from
#     /home/ubuntu/weavine/apps/web-spa/dist (SPA routes + hashed assets).
#   - Deploy = build locally → backup remote dist → rsync new dist in place.
#   - nginx picks up new files automatically (no reload needed).
#
# Usage (run from WSL — the Windows side has no key for this host):
#   scripts/deploy-web.sh                            # build + deploy
#   DIST_DIR=/path scripts/deploy-web.sh             # deploy an existing dist
#
# Required SSH: default key of the invoking user → ubuntu@110.42.215.153.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/web-spa"
DIST_DIR="${DIST_DIR:-$WEB_DIR/dist}"
PROD=${PROD:-ubuntu@110.42.215.153}
SSH="ssh -o StrictHostKeyChecking=accept-new $PROD"
REMOTE_DIST="/home/ubuntu/weavine/apps/web-spa/dist"
APP_BASE_URL="${APP_BASE_URL:-https://www.weavine.com}"

if [ ! -s "$DIST_DIR/index.html" ]; then
    echo "→ Building web-spa..."
    (cd "$REPO_ROOT" && pnpm --dir "$WEB_DIR" run build)
fi

# Sanity: dist populated (vite emits index-<hash>.js chunks).
test -s "$DIST_DIR/index.html"
first_chunk=$(compgen -G "$DIST_DIR/spa/index-*.js" | head -1 || true)
if [ -z "$first_chunk" ] || [ ! -s "$first_chunk" ]; then
    echo "→ dist is incomplete (no non-empty $DIST_DIR/spa/index-*.js)" >&2
    exit 1
fi
LOCAL_HASH=$(grep -o 'index-[^"]*\.js' "$DIST_DIR/index.html" | head -1)

# Backup the current remote dist (unix seconds so deploys don't collide).
TS=$(date +%s)
echo "→ Backing up remote dist -> dist.${TS}.bak"
$SSH "cp -r '$REMOTE_DIST' '${REMOTE_DIST}.bak.${TS}'"

echo "→ rsync $DIST_DIR/ -> $PROD:$REMOTE_DIST/"
rsync -a --chmod=D755,F644 --delete "$DIST_DIR/" "$PROD:$REMOTE_DIST/"

# Prune old dist backups (keep latest 3).
$SSH "ls -1dt ${REMOTE_DIST}.bak.* 2>/dev/null | tail -n +4 | xargs -r rm -rf --"

echo "→ Verify live bundle hash"
LIVE_HASH=$(curl -sS -m 10 "$APP_BASE_URL/today/" | grep -o 'index-[^"]*\.js' | head -1)
echo "    local=$LOCAL_HASH live=$LIVE_HASH"
if [ "$LOCAL_HASH" != "$LIVE_HASH" ]; then
    echo "✗ FAIL — live hash does not match local build" >&2
    exit 1
fi

echo "✓ Web SPA deployed to $APP_BASE_URL/"
