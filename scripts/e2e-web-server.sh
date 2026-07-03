#!/bin/bash
# weavine-web E2E test — runs the sidecar HTTP server and exercises
# both REST endpoints and the SPA fallback.
#
# Run from anywhere; the script does not need to be in the repo.
set -u

REPO=/home/yf/workspace/opencode/prm
cd "$REPO/src-tauri"

# Pick binary: prefer in-tree debug build (freshest), fall back to installed.
if [ -x "$REPO/src-tauri/target/debug/weavine-web" ]; then
  WEAVINE_WEB="$REPO/src-tauri/target/debug/weavine-web"
elif [ -x /usr/bin/weavine-web ]; then
  WEAVINE_WEB=/usr/bin/weavine-web
else
  echo "no weavine-web binary found"
  exit 1
fi
echo "using: $WEAVINE_WEB"

export WEB_DB_PATH=/tmp/weavine-e2e-test.db
rm -f "$WEB_DB_PATH" /tmp/weavine-e2e.log

# Start server with a 25s safety net.
timeout 25 "$WEAVINE_WEB" > /tmp/weavine-e2e.log 2>&1 &
SRV_PID=$!

# Wait for ready.
ready=false
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -m 1 http://127.0.0.1:3000/api/diagnostic/startup >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 0.5
done
if [ "$ready" != "true" ]; then
  echo "SERVER FAILED TO START"
  cat /tmp/weavine-e2e.log
  kill $SRV_PID 2>/dev/null
  exit 1
fi

pass=0
fail=0
failures=()

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS  $label  (expected=$expected, got=$actual)"
    pass=$((pass + 1))
  else
    echo "  FAIL  $label  (expected=$expected, got=$actual)"
    fail=$((fail + 1))
    failures+=("$label: expected=$expected, got=$actual")
  fi
}

check_status() {
  local label="$1" expected="$2" url="$3"
  shift 3
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "$@" "$url")
  check "$label" "$expected" "$code"
}

echo "=== 1. server alive ==="
pgrep -fa weavine-web | grep -v grep | head -1

echo ""
echo "=== 2. /api/diagnostic/startup (REST) ==="
check_status "GET /api/diagnostic/startup" 200 \
  http://127.0.0.1:3000/api/diagnostic/startup
body=$(curl -sS -m 3 http://127.0.0.1:3000/api/diagnostic/startup)
echo "  body: $body"
check "diagnostic body contains 'server_ready'" "true" \
  "$(echo "$body" | grep -q '"server_ready"' && echo true || echo false)"

echo ""
echo "=== 3. /api/diagnostic/user (REST) ==="
check_status "GET /api/diagnostic/user" 200 \
  http://127.0.0.1:3000/api/diagnostic/user

echo ""
echo "=== 4. /api/contacts list (REST) ==="
check_status "GET /api/contacts?owner_id=local-default" 200 \
  'http://127.0.0.1:3000/api/contacts?owner_id=local-default'
check_status "GET /api/contacts (no query) → must be 400" 400 \
  http://127.0.0.1:3000/api/contacts

echo ""
echo "=== 5. POST /api/contacts (REST, snake_case payload) ==="
http=$(curl -sS -m 3 -o /tmp/contact.json -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d '{"owner_id":"local-default","nickname":"E2E Test","name":"E2E","importance":"normal","reminder_enabled":true}' \
  http://127.0.0.1:3000/api/contacts)
check "POST /api/contacts returns 200 or 201" "true" \
  "$([ "$http" = "200" ] || [ "$http" = "201" ] && echo true || echo false)"
cat /tmp/contact.json
echo ""
contact_id=$(python3 -c "import json,sys; print(json.load(open('/tmp/contact.json'))['id'])" 2>/dev/null)
check "POST response has id" "true" \
  "$([ -n "$contact_id" ] && echo true || echo false)"

if [ -n "$contact_id" ]; then
  echo ""
  echo "=== 6. GET /api/contacts/:id (REST) ==="
  check_status "GET /api/contacts/$contact_id" 200 \
    "http://127.0.0.1:3000/api/contacts/$contact_id"
fi

echo ""
echo "=== 7. SPA fallback — hard-refresh of client routes must serve index.html ==="
for route in / /contacts /actions /events /reminders /tags /settings /search; do
  status=$(curl -s -o /tmp/spa.html -w "%{http_code}" -m 3 \
    "http://127.0.0.1:3000${route}")
  # SPA must return 200 (the fallback serves index.html with 200)
  check "hard-refresh ${route} → 200" 200 "$status"
  # Body must contain the React root div (not JSON error)
  has_root=$(grep -c 'id="root"' /tmp/spa.html 2>/dev/null || echo 0)
  check "hard-refresh ${route} serves index.html" 1 "$has_root"
done

echo ""
echo "=== 8. DB schema (13 tables, prisma-removed) ==="
table_count=$(python3 -c "
import sqlite3
c = sqlite3.connect('/tmp/weavine-e2e-test.db')
tables = sorted(r[0] for r in c.execute('SELECT name FROM sqlite_master WHERE type=\"table\"'))
print(len(tables))
")
check "DB has 13 tables" 13 "$table_count"

# Cleanup
kill $SRV_PID 2>/dev/null
wait $SRV_PID 2>/dev/null

echo ""
echo "=== summary ==="
echo "  passed: $pass"
echo "  failed: $fail"
if [ $fail -gt 0 ]; then
  echo ""
  echo "FAILURES:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
echo "  ALL CHECKS PASSED"
exit 0
