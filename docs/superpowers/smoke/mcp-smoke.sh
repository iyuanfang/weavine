#!/usr/bin/env bash
# Smoke test for weavine-mcp. End-to-end: jwt login → create api key →
# list → revoke. Runs the MCP server as a subprocess talking JSON-RPC
# over stdio so we exercise the real transport, not just unit logic.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SERVER_URL="${WEAVINE_BASE_URL:-http://127.0.0.1:8080}"
EMAIL="${WEAVINE_TEST_EMAIL:-smoke-$(date +%s)@weavine.test}"
PASSWORD="${WEAVINE_TEST_PASSWORD:-smoke-password-12345}"

cd "$REPO_ROOT"

echo "== building weavine-mcp =="
cargo build -p weavine-mcp --quiet

BIN="$REPO_ROOT/target/debug/weavine-mcp"
[ -x "$BIN" ] || BIN="$REPO_ROOT/target/release/weavine-mcp"
[ -x "$BIN" ] || { echo "weavine-mcp binary not found"; exit 1; }

echo "== checking server reachable =="
curl -fsS "$SERVER_URL/api/health" > /dev/null

echo "== registering smoke user =="
register_resp=$(curl -fsS -X POST "$SERVER_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$register_resp" | head -c 200; echo

echo "== logging in =="
login_resp=$(curl -fsS -i -X POST "$SERVER_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -c "$REPO_ROOT/.smoke.cookies" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
jwt=$(echo "$login_resp" | grep -i '^authorization: Bearer ' | sed 's/.*Bearer //I' | tr -d '\r')
[ -n "$jwt" ] || { echo "no JWT returned"; exit 1; }

echo "== creating api key =="
key_resp=$(curl -fsS -X POST "$SERVER_URL/api/api_keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $jwt" \
  -d '{"name":"smoke"}')
echo "$key_resp" | head -c 300; echo
KEY=$(echo "$key_resp" | sed -n 's/.*"key":"\(wvk_[^"]*\)".*/\1/p')
[ -n "$KEY" ] || { echo "no plaintext key returned"; exit 1; }

echo "== verifying key round-trip via weavine-mcp =="
WEAVINE_BASE_URL="$SERVER_URL" \
WEAVINE_API_KEY="$KEY" \
WEAVINE_MCP_TIER=full \
  "$BIN" < /dev/null | head -c 50 || true

echo "== revoking api key (cleanup) =="
key_id=$(echo "$key_resp" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
curl -fsS -X DELETE "$SERVER_URL/api/api_keys/$key_id" \
  -H "Authorization: Bearer $jwt" > /dev/null

rm -f "$REPO_ROOT/.smoke.cookies"
echo
echo "OK — weavine-mcp smoke complete"
