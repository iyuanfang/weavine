#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# scripts/setup-mobile.sh
#
# Sets up Tauri mobile (Android + iOS) development environment
# for the Weavine PRM project.
#
# Prerequisites:
#   - Rust toolchain (rustup)
#   - pnpm
#
# Run from project root:
#   bash scripts/setup-mobile.sh
# ============================================================

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Weavine Tauri Mobile Setup ==="
echo ""

# ── Android ───────────────────────────────────────────────────

echo "── Android ──"

# 1) Install Java (JDK 17 required for Android Gradle plugin)
if ! command -v java &>/dev/null; then
  echo "  [1/5] Installing JDK 17..."
  if [[ "$(uname)" == "Darwin" ]]; then
    brew install openjdk@17
  elif [[ -f /etc/debian_version ]]; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq openjdk-17-jdk-headless
  else
    echo "  WARNING: Unsupported OS. Please install JDK 17 manually."
  fi
else
  echo "  [1/5] JDK found: $(java -version 2>&1 | head -1)"
fi

# 2) Set JAVA_HOME (if not already)
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    export JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || echo "")
  elif [[ -d /usr/lib/jvm/java-17-openjdk-amd64 ]]; then
    export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
  elif [[ -d /usr/lib/jvm/java-17-openjdk ]]; then
    export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
  fi
  if [[ -n "${JAVA_HOME:-}" ]]; then
    echo "  [2/5] JAVA_HOME=$JAVA_HOME"
  else
    echo "  [2/5] WARNING: Could not auto-detect JAVA_HOME. Set it manually."
  fi
else
  echo "  [2/5] JAVA_HOME already set: $JAVA_HOME"
fi

# 3) Install Android Rust targets
echo "  [3/5] Installing Android Rust targets..."
rustup target add \
  aarch64-linux-android \
  armv7-linux-androideabi \
  i686-linux-android \
  x86_64-linux-android

# 4) Install Android SDK (via Tauri CLI will prompt; here we check)
if [[ -z "${ANDROID_HOME:-}" ]] && [[ -z "${ANDROID_SDK_ROOT:-}" ]]; then
  echo "  [4/5] ANDROID_HOME not set."
  echo "        Tauri will attempt to auto-detect Android Studio's SDK."
  echo "        If Android Studio is not installed, see:"
  echo "        https://v2.tauri.app/start/prerequisites/#android"
else
  echo "  [4/5] Android SDK found: ${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
fi

# 5) Initialize Android project (skips target install since we already did it)
echo "  [5/5] Running: tauri android init"
pnpm tauri android init --skip-targets-install --ci 2>&1 || {
  echo "  WARNING: 'tauri android init' failed."
  echo "           Ensure JDK 17 and Android SDK are installed."
  echo "           See docs/mobile-limitations.md for manual steps."
}

echo ""
echo "── iOS ──"
echo "  iOS requires macOS with Xcode. Skipping on this platform."
echo "  To set up iOS later on macOS:"
echo "    rustup target add aarch64-apple-ios aarch64-apple-ios-sim"
echo "    pnpm tauri ios init"
echo ""

echo "=== Done ==="
echo "See docs/mobile-limitations.md for known platform limitations."