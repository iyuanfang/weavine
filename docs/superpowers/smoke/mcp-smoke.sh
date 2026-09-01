#!/usr/bin/env bash
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
curl -fsS "$SERVER_URL/api/diagnostic/startup" > /dev/null

echo "== registering smoke user =="
register_resp=$(curl -fsS -X POST "$SERVER_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"display_name\":\"smoke\",\"device\":{\"name\":\"smoke\",\"os\":\"linux\",\"app_version\":\"0.0.0\"}}")
jwt=$(echo "$register_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
[ -n "$jwt" ] || { echo "no JWT returned from register"; exit 1; }

echo "== creating api key =="
key_resp=$(curl -fsS -X POST "$SERVER_URL/api/api_keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $jwt" \
  -d '{"name":"smoke"}')
echo "$key_resp" | head -c 200; echo
KEY=$(echo "$key_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))")
[ -n "$KEY" ] || { echo "no plaintext key returned"; exit 1; }
KEY_ID=$(echo "$key_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "== verifying round-trip via weavine-mcp stdio JSON-RPC =="
python3 - "$BIN" "$SERVER_URL" "$KEY" << 'PYEOF'
import sys, json, subprocess, os, time

bin_path, server_url, api_key = sys.argv[1], sys.argv[2], sys.argv[3]
env = {**os.environ, "WEAVINE_MCP_API_KEY": api_key, "WEAVINE_MCP_BASE_URL": server_url}

p = subprocess.Popen(
    [bin_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL, env=env, bufsize=0,
)

def send(obj):
    p.stdin.write((json.dumps(obj) + "\n").encode())
    p.stdin.flush()

def recv():
    line = p.stdout.readline()
    return json.loads(line.decode()) if line else None

send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}})
init = recv()
assert init and init.get("result", {}).get("serverInfo", {}).get("name") == "weavine-mcp", f"init failed: {init}"

time.sleep(0.2)
send({"jsonrpc":"2.0","method":"notifications/initialized"})
time.sleep(0.2)
send({"jsonrpc":"2.0","id":2,"method":"tools/list"})
tools = recv()
assert tools and "result" in tools, f"tools/list failed: {tools}"
tool_count = len(tools["result"]["tools"])
empty = [t["name"] for t in tools["result"]["tools"] if not t.get("inputSchema")]
print(f"  tools/list -> {tool_count} tools; {len(empty)} empty schemas (expected for no-arg tools)")
assert tool_count >= 32, f"expected ≥32 tools, got {tool_count}"
assert len(empty) <= 3, f"unexpected empty schemas: {empty}"

time.sleep(0.2)
send({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_api_keys","arguments":{}}})
call = recv()
assert call and call.get("result", {}).get("isError") is False, f"list_api_keys failed: {call}"
content = call["result"]["content"][0]
print(f"  list_api_keys call -> isError=False; content type={content.get('type')}")

p.stdin.close(); p.terminate(); p.wait(timeout=2)
print("  MCP round-trip OK")
PYEOF

echo "== revoking api key (cleanup) =="
curl -fsS -X DELETE "$SERVER_URL/api/api_keys/$KEY_ID" \
  -H "Authorization: Bearer $jwt" > /dev/null

echo
echo "OK — weavine-mcp smoke complete (32+ tools, schemas populated, round-trip OK)"
