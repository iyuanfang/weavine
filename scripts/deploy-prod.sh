#!/usr/bin/env bash
set -euo pipefail
# Deploy PRM to production: build locally, archive, scp, install, migrate, restart
# Usage: bash scripts/deploy-prod.sh [--skip-build]

APP="prm"
REMOTE="root@47.79.43.80"
REMOTE_DIR="/opt/$APP"
RELEASE_DIR="$REMOTE_DIR/releases"
RELEASE_NAME="$APP.release.$(date +%Y%m%d%H%M%S)"
ARCHIVE="/tmp/$RELEASE_NAME.tar.gz"
SITE="ai.financialagent.cc"
HEALTH_URL="https://$SITE/api/health"
# Max releases to keep (including the active one)
MAX_KEEP=5

echo "==> Deploying $RELEASE_NAME to $SITE"

# ── 1. Build locally ──────────────────────────────────────────
if [[ "${1:-}" != "--skip-build" ]]; then
  echo "==> Building locally for type checking..."
  pnpm build 2>&1
fi

# ── 2. Archive (include src for server-side build) ────────────
echo "==> Archiving..."
tar --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='scripts' \
    --exclude='prisma/seed.ts' \
    --exclude='*.test.ts' \
    --exclude='*.spec.ts' \
    --exclude='__tests__' \
    --exclude='__snapshots__' \
    -czf "$ARCHIVE" \
    prisma \
    public \
    src \
    package.json \
    pnpm-lock.yaml \
    tsconfig.json \
    next.config.mjs \
    tailwind.config.ts \
    postcss.config.mjs \
    node_modules/.pnpm

# ── 3. Upload ─────────────────────────────────────────────────
echo "==> Uploading to $REMOTE..."
scp "$ARCHIVE" "$REMOTE:$ARCHIVE"

# ── 4. Remote: unbox, install, migrate, symlink, restart ─────
echo "==> Running remote deployment..."
ssh "$REMOTE" bash -s -- "$RELEASE_DIR" "$RELEASE_NAME" "$REMOTE_DIR" "$APP" "$HEALTH_URL" "$MAX_KEEP" <<'REMOTESCRIPT'
set -euo pipefail
RDIR="$1"; RNAME="$2"; BASE="$3"; APP="$4"; HEALTH="$5"; MAX_KEEP="${6:-5}"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

mkdir -p "$RDIR/$RNAME"
cd "$RDIR/$RNAME"
tar xzf "/tmp/$RNAME.tar.gz"

# Source env vars from server's external .env
if [ -f /opt/prm/.env ]; then
  set -a
  source /opt/prm/.env 2>/dev/null || true
  set +a
elif [ -f .env ]; then
  set -a
  source .env 2>/dev/null || true
  set +a
fi

# ── Production env overrides ─────────────────────────────────
# Force production URL for Auth.js callbacks (server .env may have stale dev value)
export AUTH_URL="https://$SITE"
# Trust X-Forwarded-Proto/Host from nginx reverse proxy
export AUTH_TRUST_HOST="1"
# Generate AUTH_SECRET if missing
if [ -z "${AUTH_SECRET:-}" ]; then
  echo "==> WARNING: AUTH_SECRET is empty — generating one..."
  export AUTH_SECRET="$(openssl rand -base64 32)"
fi

# Install dependencies
pnpm install --frozen-lockfile 2>&1 | tail -3

# Prisma (must run BEFORE next build)
npx prisma generate 2>&1 | tail -1
npx prisma migrate deploy 2>&1 | tail -1

# Build on server (local .next is incompatible with next start)
echo "==> Building on server..."
npx next build 2>&1 | tail -5

# Symlink current (in /opt/prm/)
ln -sfn "$RDIR/$RNAME" "$BASE/current"

# Generate PM2 ecosystem config with correct cwd and production env
AUTH_URL_VAL="https://$SITE"
cat > "$BASE/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: "$APP",
    cwd: "$RDIR/$RNAME",
    exec_mode: "fork",
    script: "npm",
    args: "start",
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      PORT: "3100",
      AUTH_URL: "$AUTH_URL_VAL",
      AUTH_TRUST_HOST: "1"
    }
  }]
};
EOF

# Delete existing PM2 process to avoid stale cwd/env from previous release
pm2 delete "$APP" 2>/dev/null || true

echo "==> Starting PM2 with new release..."
pm2 start "$BASE/ecosystem.config.js" --update-env 2>&1 | tail -3

# Persist fresh process metadata
pm2 save >/dev/null 2>&1 || true

# Health check
echo "==> Health check: $HEALTH"
for i in $(seq 1 12); do
  sleep 5
  status=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH" || echo "000")
  if [ "$status" = "200" ]; then
    echo "==> Health check passed (HTTP 200)"
    break
  fi
  if [ "$i" = 12 ]; then
    echo "==> Health check FAILED after 60s (HTTP $status) — rolling back"
    # Don't auto-rollback — manual intervention required
    echo "==> Please run: bash scripts/rollback-prod.sh"
    exit 1
  fi
  echo "    attempt $i/12 — HTTP $status, waiting..."
done

# ── 5. Remote: prune old releases ─────────────────────────────
echo "==> Pruning old releases..."
ls -t "$RDIR" | tail -n +$((MAX_KEEP + 1)) | while read -r old; do
  echo "    removing $old"
  rm -rf "$RDIR/$old"
done

REMOTESCRIPT

# ── 6. Cleanup local archive ──────────────────────────────────
rm -f "$ARCHIVE"
echo "==> Done: $RELEASE_NAME"
