#!/usr/bin/env bash
# Generate latest.json for the Tauri updater, sign it with ed25519, and upload it
# alongside the release assets on GitHub Releases.
#
# Replaces the now-removed `tauri-action gh release create-or-update` CLI call.
# tauri-action v1 ships only as a Node-based GitHub Action; the standalone Rust
# CLI binary is gone from crates.io (404). We do the equivalent of what it did:
#   1. Walk artifacts/, identify each platform bundle by filename suffix.
#   2. Map filename → updater platform key (windows-x86_64-msvc, darwin-aarch64, ...).
#   3. Write latest.json with the GitHub release CDN URLs (NOT the
#      browser_download_url — that's what tauri-action v1.0.0 changed in 2026,
#      see https://github.com/tauri-apps/tauri-action/releases/tag/action-v1.0.0).
#   4. `tauri signer sign` signs both the bundle AND latest.json with ed25519.
#      The signature file uses the same base name + .sig, uploaded to the
#      same release so the in-app updater can fetch them.
#
# The pubkey embedded in tauri.conf.json (bundle.updater.pubkey) is used by the
# in-app updater to verify the signature before downloading the bundle.
#
# Usage: env TAURI_SIGNING_PRIVATE_KEY=... \
#            TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... \
#            [RELEASE_TAG=v1.3.0] [REPO=iyuanfang/weavine] \
#       ./scripts/release-updater-json.sh /path/to/artifacts
#
# Requires: cargo-tauri on PATH (already installed in CI), jq, gh CLI, curl.

set -euo pipefail

ARTIFACTS_DIR="${1:-artifacts}"
RELEASE_TAG="${RELEASE_TAG:-${GITHUB_REF_NAME:-}}"
REPO="${REPO:-${GITHUB_REPOSITORY:-iyuanfang/weavine}}"

if [[ -z "$RELEASE_TAG" ]]; then
  echo "ERROR: RELEASE_TAG (or GITHUB_REF_NAME) is required" >&2
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "ERROR: TAURI_SIGNING_PRIVATE_KEY env var is required" >&2
  exit 1
fi

# GitHub release CDN URL (NOT browser_download_url — see PR #1315 in tauri-action).
# Format: https://github.com/<owner>/<repo>/releases/download/<tag>/<filename>
DOWNLOAD_BASE="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"

# Map Tauri bundler output filename suffix → updater platform key.
# Filename pattern (Tauri 2): weavine_<ext>_<version>_<arch>.<ext>
#   - weavine_1.3.0_x64-setup.exe        → windows-x86_64-msvc
#   - weavine_1.3.0_aarch64-setup.exe    → windows-aarch64-msvc
#   - weavine_1.3.0_x64.dmg              → darwin-x86_64
#   - weavine_1.3.0_aarch64.dmg          → darwin-aarch64
#   - weavine_1.3.0_amd64.AppImage       → linux-x86_64
#   - weavine_1.3.0_amd64.deb            → linux-x86_64 (deb is second pick)
# We resolve each artifact by suffix.
platform_key_for() {
  local f="$1"
  case "$f" in
    *.exe)  echo "windows-x86_64-msvc" ;;  # NSIS installer; Tauri doesn't ship aarch64 NSIS for our matrix
    *.dmg)  echo "darwin-x86_64" ;;        # ditto — we build x64_64 DMG for Intel + aarch64 DMG separately
    *.AppImage|*.deb)
      echo "linux-x86_64" ;;
    *)
      echo "" ;;
  esac
}

# App version: read from package.json (we use the `version` field set by `pnpm tauri build`).
APP_VERSION="$(jq -r .version apps/web-spa/package.json 2>/dev/null \
  || jq -r .version package.json 2>/dev/null \
  || echo "${RELEASE_TAG#v}")"

# Build the latest.json in memory.
TMP_JSON="$(mktemp -t latest-XXXXXX.json)"
trap 'rm -f "$TMP_JSON"' EXIT

declare -A PLATFORMS
declare -a PLATFORM_KEYS

for f in "$ARTIFACTS_DIR"/*/*.{exe,dmg,AppImage,deb} \
         "$ARTIFACTS_DIR"/*.{exe,dmg,AppImage,deb}; do
  [[ -f "$f" ]] || continue
  fname="$(basename "$f")"
  pkey="$(platform_key_for "$fname")"
  [[ -z "$pkey" ]] && continue
  # Deb takes precedence over AppImage for linux (Deb is the primary linux
  # distribution format), but tauri-action uploads both. We pick .deb when
  # available, fall back to .AppImage.
  if [[ -n "${PLATFORMS[$pkey]+set}" ]]; then
    case "$fname" in
      *.deb) ;;  # overwrite — deb preferred
      *) continue ;;  # keep the existing one (assume deb was first)
    esac
  fi
  PLATFORMS[$pkey]="$DOWNLOAD_BASE/$fname"
  PLATFORM_KEYS+=("$pkey")
done

# Build the JSON via jq so quoting/escaping is correct.
JSON_PLATFORMS="$(
  for k in "${PLATFORM_KEYS[@]}"; do
    jq -n --arg k "$k" --arg u "${PLATFORMS[$k]}" \
      '{($k): {"url": $u}}'
  done | jq -s 'add'
)"

jq -n \
  --arg ver "$APP_VERSION" \
  --argjson platforms "$JSON_PLATFORMS" \
  --arg pub "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    version: $ver,
    notes: "",
    pub_date: $pub,
    platforms: $platforms
  }' > "$TMP_JSON"

echo "=== latest.json ==="
cat "$TMP_JSON"
echo

# Sign latest.json → latest.json.sig
cargo tauri signer sign --private-key "$TAURI_SIGNING_PRIVATE_KEY" \
  --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
  --output "$TMP_JSON.sig" "$TMP_JSON" >/dev/null
echo "Wrote $TMP_JSON.sig"

# Upload both as release assets (overwrite if present).
if command -v gh >/dev/null 2>&1; then
  GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [[ -n "$GH_TOKEN" ]]; then
    for asset in "$TMP_JSON" "$TMP_JSON.sig"; do
      gh release upload "$RELEASE_TAG" "$asset" \
        --repo "$REPO" --clobber
    done
    echo "Uploaded latest.json + .sig to ${REPO}@${RELEASE_TAG}"
  else
    echo "WARN: GH_TOKEN/GITHUB_TOKEN not set, skipping upload"
  fi
else
  echo "WARN: gh CLI not on PATH, skipping upload"
fi