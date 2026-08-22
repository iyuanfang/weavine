#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LANDING_DIR="$REPO_ROOT/apps/landing"
DIST_DIR="$LANDING_DIR/dist"
REMOTE_PATH="${REMOTE_PATH:-/www/weavine/landing/}"
SERVER="${SERVER:?SERVER env var required, e.g. SERVER=user@weavine.example.com}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new}"

if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "→ Building landing..."
  (cd "$LANDING_DIR" && pnpm install --frozen-lockfile && pnpm build)
fi

echo "→ Uploading to $SERVER:$REMOTE_PATH"
rsync -avz --delete \
  -e "ssh $SSH_OPTS" \
  "$DIST_DIR/" \
  "$SERVER:$REMOTE_PATH"

echo "→ Reloading nginx on $SERVER"
ssh $SSH_OPTS "$SERVER" 'sudo nginx -t && sudo systemctl reload nginx'

echo "✓ Landing deployed to https://weavine.financialagent.cc/"
