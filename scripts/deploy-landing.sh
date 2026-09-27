#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LANDING_DIR="$REPO_ROOT/apps/landing"
DIST_DIR="$LANDING_DIR/dist"
# nginx serves the landing from /home/ubuntu/weavine/apps/landing/dist
# (see /etc/nginx/sites-enabled/weavine: `root /home/ubuntu/weavine/apps/landing/dist;`).
# The /www/weavine/landing/ path is a leftover from an earlier deploy scheme
# and is NOT what nginx reads — point REMOTE_PATH at the real root.
REMOTE_PATH="${REMOTE_PATH:-/home/ubuntu/weavine/apps/landing/dist/}"
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

echo "✓ Landing deployed to https://www.weavine.com/"
