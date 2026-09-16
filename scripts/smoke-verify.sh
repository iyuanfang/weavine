#!/usr/bin/env bash
# scripts/smoke-verify.sh — post-deploy smoke (run on wy)
set -euo pipefail
echo "--- /api/health ---"
curl -sS -m 5 https://www.weavine.com/api/health
echo
echo "--- login ---"
LOGIN=$(curl -sS -m 10 -X POST https://www.weavine.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"pesome@gmail.com","password":"kejukeji1","device":{"name":"deploy-verify","os":"linux","app_version":"1.5.1"}}')
TOKEN=$(echo "$LOGIN" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')
echo "token length=${#TOKEN}"
echo "--- notes (entity_types) ---"
curl -sS -m 10 https://www.weavine.com/api/notes -H "Authorization: Bearer $TOKEN" \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
items = d["items"]
first = items[0] if items else {}
print(len(items), "notes; entity_types present:", "entity_types" in first)
'
echo "--- SPA hash ---"
curl -sS -m 10 https://www.weavine.com/today/ | grep -o 'index-[^"]*\.js' | head -1