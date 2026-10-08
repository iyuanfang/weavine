#!/usr/bin/env bash
# scripts/fetch-release.sh — fetch GitHub release assets onto wy (run ON wy)
# Usage: fetch-release.sh v1.5.1
set -euo pipefail
VER=${1:?usage: fetch-release.sh <tag>}
DEST=/home/ubuntu/weavine/www-downloads/$VER
REPO=iyuanfang/weavine
mkdir -p "$DEST"
cd "$DEST"
curl -sS "https://api.github.com/repos/$REPO/releases/tags/$VER" \
  | python3 -c 'import sys,json
for a in json.load(sys.stdin)["assets"]:
    print(a["name"], a["browser_download_url"])' \
  | while read -r name url; do
      echo "→ $name"
      curl -sSL -o "$name" "$url"
    done
ls -la "$DEST"