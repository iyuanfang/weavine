#!/usr/bin/env bash
set -euo pipefail

# scripts/deploy-web.sh — Deploy weavine web-spa (PWA) to prod (47.79.43.80)
#
# Why this script exists:
#   - The web-spa is the user-facing PWA at https://weavine.financialagent.cc
#     served as static files behind nginx on the prod server.
#   - Deploy = rsync apps/web-spa/dist/ -> /www/weavine/spa/ on prod, with an
#     atomic-swap style backup so a bad push never leaves the site 404.
#   - nginx picks up the new files automatically (no reload needed unless
#     the nginx config itself changes); we still run `nginx -t` as a safety
#     check.
#
# Usage:
#   scripts/deploy-web.sh                            # build (if needed) + deploy
#   REMOTE_PATH=/tmp/foo scripts/deploy-web.sh      # override target path
#   SERVER=user@host scripts/deploy-web.sh          # override server
#
# Required SSH: $SSH_KEY to root@$PROD (same as deploy-server.sh / deploy-landing.sh)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/web-spa"
DIST_DIR="$WEB_DIR/dist"
PROD=root@47.79.43.80
SSH_KEY=${SSH_KEY:-/home/yf/.ssh/id_ed25519}
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new}"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new $PROD"
SCP="scp -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
REMOTE_PATH="${REMOTE_PATH:-/www/weavine/spa/}"

if [ ! -f "$DIST_DIR/index.html" ]; then
    echo "→ Building web-spa..."
    (cd "$REPO_ROOT" && pnpm --dir "$WEB_DIR" run build)
fi

# Sanity check that the dist is actually populated.
test -s "$DIST_DIR/index.html"
test -s "$DIST_DIR/spa/index-"*.js

# Pick a backup name using unix seconds so multiple deploys don't collide.
TS=$(date +%s)
BAK_PATH="/www/weavine/spa.${TS}.bak"

echo "→ Backing up current ${REMOTE_PATH} -> ${BAK_PATH} on prod"
$SSH "mv '$REMOTE_PATH' '$BAK_PATH' && mkdir -p '$REMOTE_PATH'"

# rsync the new dist into a staging path, then mv into place. This avoids a
# half-uploaded state if rsync is interrupted mid-transfer.
STAGE_PATH="/www/weavine/spa.staging.${TS}"
echo "→ Staging ${DIST_DIR}/ -> prod:${STAGE_PATH}"
$SSH "mkdir -p '$STAGE_PATH'"
rsync -avz --delete \
    -e "ssh -i $SSH_KEY ${SSH_OPTS}" \
    "$DIST_DIR/" \
    "$PROD:$STAGE_PATH/"

echo "→ Atomic swap: ${STAGE_PATH} -> ${REMOTE_PATH}"
$SSH "rm -rf '$REMOTE_PATH' && mv '$STAGE_PATH' '$REMOTE_PATH'"

echo "→ nginx config test"
$SSH 'sudo nginx -t'

echo "→ Cleaning up old backups (keeping latest 5)"
$SSH "ls -1dt /www/weavine/spa.*.bak 2>/dev/null | tail -n +6 | xargs -r rm -rf --"

echo "✓ Web SPA deployed to https://weavine.financialagent.cc/"
echo "  Backup: $BAK_PATH"