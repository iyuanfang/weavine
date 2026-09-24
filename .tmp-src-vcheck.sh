#!/usr/bin/env bash
set -euo pipefail
TOKEN=$(curl -s -m 10 -X POST https://www.weavine.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"pesome@gmail.com","password":"kejukeji1","device":{"name":"v","os":"linux","app_version":"0"}}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s -m 60 -X POST https://www.weavine.com/api/voice/recognize \
  -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/test-voice.wav;type=audio/wav" | head -c 200
echo
curl -s -m 10 https://www.weavine.com/today/ | grep -o 'index-[^"]*\.js' | head -1
