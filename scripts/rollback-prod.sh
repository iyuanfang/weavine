#!/usr/bin/env bash
set -euo pipefail
# Rollback PRM to previous release
# Usage: bash scripts/rollback-prod.sh

APP="prm"
REMOTE="root@47.79.43.80"
REMOTE_DIR="/opt/$APP"
SITE="weavine.financialagent.cc"
HEALTH_URL="https://$SITE/api/health"

ssh "$REMOTE" bash -s -- "$REMOTE_DIR" "$APP" "$HEALTH_URL" <<'REMOTESCRIPT'
set -euo pipefail
BASE="$1"; APP="$2"; HEALTH="$3"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

CURRENT="$(readlink "$BASE/current" || true)"
PREVIOUS="$(readlink "$BASE/previous" || true)"

if [ -z "$PREVIOUS" ] || [ ! -d "$BASE/releases/$PREVIOUS" ]; then
  echo "No previous release found at $BASE/releases/$PREVIOUS"
  exit 1
fi

echo "==> Rolling back: $CURRENT → $PREVIOUS"

# Symlink current as new previous, then swap
ln -sfn "$BASE/current" "$BASE/previous_new" 2>/dev/null || true
ln -sfn "$BASE/releases/$PREVIOUS" "$BASE/current"
mv "$BASE/previous_new" "$BASE/previous" 2>/dev/null || true

# Regenerate PM2 ecosystem config pointing to rolled-back release
cat > "$BASE/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: "$APP",
    cwd: "$BASE/releases/$PREVIOUS",
    exec_mode: "fork",
    script: "npm",
    args: "start",
    max_memory_restart: "512M",
    env: { NODE_ENV: "production", PORT: "3100" }
  }]
};
EOF

# Delete existing PM2 process to avoid stale cwd/env from previous release
pm2 delete "$APP" 2>/dev/null || true

pm2 start "$BASE/ecosystem.config.js" --update-env 2>&1 | tail -3

# Persist fresh process metadata
pm2 save >/dev/null 2>&1 || true

echo "==> Health check: $HEALTH"
for i in $(seq 1 12); do
  sleep 5
  status=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH" || echo "000")
  if [ "$status" = "200" ]; then
    echo "Health check passed (HTTP 200)"
    break
  fi
  if [ "$i" = 12 ]; then
    echo "Health check FAILED after 60s (HTTP $status)"
    exit 1
  fi
  echo "  attempt $i/12 — HTTP $status, waiting..."
done

echo "==> Rollback complete: $PREVIOUS"

REMOTESCRIPT