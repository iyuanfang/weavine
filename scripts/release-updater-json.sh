#!/usr/bin/env bash
# Generate latest.json for the Tauri updater and sign it with minisign.
# Output is written under $ARTIFACTS_DIR/ so the next workflow step
# (softprops/action-gh-release) can pick up everything via its files: glob
# in a single upload. No upload happens in this script.
#
# Replaces the now-removed `tauri-action gh release create-or-update` CLI call.
# tauri-action v1 ships only as a Node-based GitHub Action; the standalone Rust
# CLI binary is gone from crates.io (404). We do the equivalent of what it did:
#   1. Walk $ARTIFACTS_DIR/, identify each platform bundle by filename suffix.
#   2. Map filename → updater platform key (windows-x86_64-msvc, darwin-aarch64, ...).
#   3. Write latest.json with the GitHub release CDN URLs (NOT the
#      browser_download_url — that's what tauri-action v1.0.0 changed in 2026,
#      see https://github.com/tauri-apps/tauri-action/releases/tag/action-v1.0.0).
#   4. Sign latest.json with minisign — the signature format is bit-identical
#      to what `cargo tauri signer sign` produces (both wrap minisign), so the
#      in-app Tauri updater verifies without any change. We use minisign instead
#      of tauri-cli to avoid a 5+ min `cargo install tauri-cli` compile on the
#      release job's fresh runner.
#
# The pubkey embedded in tauri.conf.json (bundle.updater.pubkey) is used by the
# in-app updater to verify the signature before downloading the bundle.
#
# Usage: env TAURI_SIGNING_PRIVATE_KEY=... \
#            [TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...] \
#            [RELEASE_TAG=v1.3.0] [REPO=iyuanfang/weavine] \
#       ./scripts/release-updater-json.sh /path/to/artifacts
#
# Requires: minisign (apt), jq.

set -euo pipefail

# Echo every command for debugging.
PS4='+ [${LINENO}] '
set -x

ARTIFACTS_DIR="${1:-artifacts}"
RELEASE_TAG="${RELEASE_TAG:-${GITHUB_REF_NAME:-}}"
REPO="${REPO:-${GITHUB_REPOSITORY:-iyuanfang/weavine}}"

if [[ -z "$RELEASE_TAG" ]]; then
  echo "ERROR: RELEASE_TAG (or GITHUB_REF_NAME) is required" >&2
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  echo "ERROR: TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is required" >&2
  exit 1
fi

if ! command -v minisign >/dev/null 2>&1; then
  echo "ERROR: minisign not installed (apt-get install -y minisign)" >&2
  exit 1
fi

# GitHub release CDN URL (NOT browser_download_url — see PR #1315 in tauri-action).
# Format: https://github.com/<owner>/<repo>/releases/download/<tag>/<filename>
DOWNLOAD_BASE="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"

platform_key_for() {
  local f="$1"
  case "$f" in
    *aarch64*.exe|*arm64*.exe)
      echo "windows-aarch64-msvc" ;;
    *x64*.exe|*x86_64*.exe|*.exe)
      echo "windows-x86_64-msvc" ;;
    *aarch64*.dmg|*arm64*.dmg)
      echo "darwin-aarch64" ;;
    *x64*.dmg|*x86_64*.dmg|*.dmg)
      echo "darwin-x86_64" ;;
    *.AppImage|*.deb)
      echo "linux-x86_64" ;;
    *)
      echo "" ;;
  esac
}

APP_VERSION="$(jq -r .version apps/web-spa/package.json 2>/dev/null \
  || jq -r .version package.json 2>/dev/null \
  || echo "${RELEASE_TAG#v}")"

# Write under $ARTIFACTS_DIR/updater/ — softprops' `artifacts/**/*.sig`
# glob does NOT match files directly under artifacts/ (root-level), only
# files at depth ≥ 1. latest.json at the root worked by accident (caught
# by `*.json`) but latest.json.sig at the root was silently dropped.
LATEST_JSON="${ARTIFACTS_DIR}/updater/latest.json"
LATEST_SIG="${LATEST_JSON}.sig"
mkdir -p "${ARTIFACTS_DIR}/updater"

TMP_KEY="$(mktemp -t weavine-key-XXXXXX.key)"
# Clean up the keyfile on exit; latest.json + .sig must persist for the
# softprops step that runs immediately after this one.
trap 'rm -f "$TMP_KEY"' EXIT

declare -A PLATFORMS
declare -a PLATFORM_KEYS

# Include *.apk in the walk so the manifest knows about the Android APK even
# though Android doesn't auto-update via latest.json (no tauri-plugin-updater
# on Android — desktop only). The Android entry is informational: the JSON
# map is platform-keyed by Tauri updater convention, and Android doesn't use
# any of those keys, so the apk is ignored at lookup time on devices. Keeping
# the apk out of the platform map entirely would leave it orphaned from the
# manifest but still listed in `gh release view`.
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  fname="$(basename "$f")"
  pkey="$(platform_key_for "$fname")"
  [[ -z "$pkey" ]] && continue
  if [[ -n "${PLATFORMS[$pkey]+set}" ]]; then
    case "$fname" in
      *.deb) ;;
      *) continue ;;
    esac
  fi
  PLATFORMS[$pkey]="$DOWNLOAD_BASE/$fname"
  PLATFORM_KEYS+=("$pkey")
done < <(find "$ARTIFACTS_DIR" -type f \( -name "*.exe" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.deb" \) 2>/dev/null)

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
  }' > "$LATEST_JSON"

echo "=== latest.json written to $LATEST_JSON ==="
cat "$LATEST_JSON"
echo

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  cp "$TAURI_SIGNING_PRIVATE_KEY_PATH" "$TMP_KEY"
else
  echo "$TAURI_SIGNING_PRIVATE_KEY" | base64 -d > "$TMP_KEY"
fi

# minisign prompts for password on stdin when key is encrypted and no TTY.
# `MINISIGN_KEY_PASSWD` is the documented non-interactive variable that
# minisign's pinentry fallback consults.
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  export MINISIGN_KEY_PASSWD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
fi

minisign -S -s "$TMP_KEY" -m "$LATEST_JSON" -x "$LATEST_SIG" \
  -t "weavine updater manifest ${RELEASE_TAG}"
echo "=== wrote $LATEST_SIG ==="

# Sanity check before softprops picks it up.
[[ -s "$LATEST_JSON" ]]  || { echo "FATAL: $LATEST_JSON empty" >&2; exit 1; }
[[ -s "$LATEST_SIG" ]]   || { echo "FATAL: $LATEST_SIG empty" >&2; exit 1; }
echo "Manifest + signature staged under $ARTIFACTS_DIR/ — softprops will upload next."