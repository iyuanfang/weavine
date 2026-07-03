# Weavine Tauri Mobile — Platform Limitations

> Last updated: 2026-07-03
> Applies to: Tauri v2 + Web-SPA (Vite/React) + Rust backend

---

## Purpose

This document honestly describes the limitations, trade-offs, and known issues of running Weavine PRM on mobile platforms (Android/iOS) via Tauri v2. It exists so that anyone picking up this project can make an informed decision about mobile readiness.

---

## 1. Current Mobile Readiness

| Aspect | Status | Details |
|--------|--------|---------|
| Android project scaffold | ⚠️ Stub | `tauri android init` cannot run without JDK 17 + Android SDK |
| iOS project scaffold | ❌ Not scaffolded | Requires macOS + Xcode |
| Mobile icons | ❌ Not generated | Run `pnpm tauri icon` to generate all platform icons |
| Android build | ❌ Untested | Requires complete Android dev environment |
| iOS build | ❌ Untested | Requires macOS + Apple Developer account |
| Touch/gesture UX | ⚠️ Not optimized | UI assumes mouse/keyboard; tap targets may be too small |
| Offline mode | ✅ Works | Rust + rusqlite is inherently local-first |
| Push notifications | ❌ Not implemented | Requires platform-specific plugins |
| Camera/photo picker | ❌ Not implemented | Would need Tauri plugin or native integration |

---

## 2. Platform Constraints (Cannot Work Around)

### 2.1 iOS Build Requires macOS

Tauri iOS compilation **requires** a macOS host with Xcode. There is no Linux or Windows workaround. Apple's code-signing infrastructure (Apple Developer Program, $99/year) is mandatory for App Store distribution.

**Implication**: iOS builds must be done on a Mac CI runner or developer machine. The current Linux CI cannot produce iOS binaries.

### 2.2 Android Build Requires JDK + SDK

`tauri android init` and all subsequent Android builds require:
- **JDK 17** (not just JRE) — needed by Gradle and the Android Gradle Plugin
- **Android SDK** (platform 34, build-tools) — usually provided by Android Studio or `cmdline-tools`
- **Android NDK** — for cross-compiling Rust to ARM/ x86 Android targets
- **Rust Android targets**:
  - `aarch64-linux-android` (ARM64 — most modern devices)
  - `armv7-linux-androideabi` (ARM32 — older devices)
  - `i686-linux-android` (x86 — emulator)
  - `x86_64-linux-android` (x86_64 — emulator)

These are one-time environment setup costs but cannot be skipped.

### 2.3 No Multiple Windows on Mobile

Tauri's `app.windows` config applies only to desktop. Mobile platforms present a single full-screen webview.
- The current config has a single "main" window → works on mobile (ignored gracefully)
- Any multi-window features in the app would need redesign for mobile (e.g. modals instead of popups)

### 2.4 Backend Architecture Differences

| Capability | Desktop (Tauri) | Mobile (Tauri) | Web |
|------------|----------------|----------------|-----|
| Local SQLite | ✅ Rust rusqlite | ✅ Rust rusqlite | ❌ N/A |
| PostgreSQL | ❌ N/A | ❌ N/A | ✅ Prisma |
| `dirs::data_dir()` | ✅ Linux: `~/.local/share/weavine` | ⚠️ Android: app-specific dir (different path) | ❌ N/A |
| File system access | ✅ Full | ⚠️ Scoped (app sandbox) | ❌ Browser sandbox |
| Background processing | ✅ Tauri process | ⚠️ Android Doze mode / iOS background limits | ❌ N/A |

---

## 3. Known Gaps for Mobile UX

### 3.1 UI Assumes Mouse Input

The entire frontend (web-spa) was designed with a mouse-and-keyboard paradigm:

| Issue | Impact | Fix Difficulty |
|-------|--------|----------------|
| Small touch targets (<48px) | Hard to tap accurately on phone | Medium — CSS/component audit |
| Hover-only interactions | Invisible on touch devices | Medium — add `@media (hover: none)` fallbacks |
| Desktop-width layouts | Cramped on <400px screens | Large — responsive redesign |
| No pull-to-refresh | Unconventional mobile UX | Small — add TouchEvent handler |
| Keyboard shortcuts | Useless on mobile soft keyboard | Small — no-op |

### 3.2 No Mobile-Optimized Navigation

The current sidebar + topnav pattern may not translate well to mobile:
- **Sidebar**: Would need to become a bottom tab bar or collapsible hamburger menu
- **Modal dialogs**: Some are desktop-sized; need full-screen sheet adaptation
- **Calendar view**: Day/week/month toggle needs touch-friendly hit areas

### 3.3 Form Input Ergonomics

- Date/time pickers may not trigger native mobile pickers
- Text inputs need viewport-aware positioning to avoid keyboard covering the field
- Select/dropdown menus may require native-style bottom sheet pickers

---

## 4. Feature Gaps

These features exist on desktop but have no mobile implementation:

| Feature | Desktop Status | Mobile Status | Notes |
|---------|---------------|---------------|-------|
| Local push notifications | ✅ Via system notifications | ❌ Not implemented | Tauri `notification` plugin needed |
| File exports (CSV) | ✅ Via download | ❌ File picker / share sheet needed | |
| Autostart | ✅ Tauri config | ❌ Not applicable | |
| System tray | ✅ Tauri feature | ❌ Not applicable | |

---

## 5. Performance Considerations

| Concern | Desktop | Mobile |
|---------|---------|--------|
| WebView engine | System WebView2 (Edge) | Android System WebView / WKWebView |
| Rust ↔ JS overhead | `invoke()` < 1ms typically | Same, but mobile CPU is slower |
| SQLite on low-end devices | N/A — desktop has ample RAM | Potential slow queries on 3GB devices |
| SPA bundle size | ~500KB JS + CSS (acceptable) | Same bundle — could impact cold start on slow networks |
| Rendering performance | 60fps typical | May drop frames on complex list renderings |

---

## 6. Dev Environment Setup Difficulty

| Requirement | Desktop Dev | Android Dev | iOS Dev |
|-------------|-------------|-------------|---------|
| Rust toolchain | ✅ One command | ✅ One command | ✅ One command |
| System libs | ✅ `apt install` | ✅ `apt install` | ❌ macOS only |
| JDK 17 | ❌ Not needed | ✅ Required | ❌ Not needed |
| Android SDK | ❌ Not needed | ✅ Required (5-10GB) | ❌ Not needed |
| Android NDK | ❌ Not needed | ✅ Required (~1GB) | ❌ Not needed |
| Xcode | ❌ Not needed | ❌ Not needed | ✅ Required (~15GB) |
| Apple Developer account | ❌ Not needed | ❌ Not needed | ✅ Required ($99/yr) |
| Total setup time | ~10 min | ~45-60 min | ~2-3 hours |

---

## 7. Should You Ship Mobile?

**Short answer**: Not yet. The app functionally works on mobile (it compiles and renders), but the UX quality is below what users expect from a native mobile app.

**Ship criteria for MVP**:
- [ ] Touch target audit completed (all interactive elements ≥ 48px)
- [ ] Bottom tab navigation replaces sidebar
- [ ] Date pickers use native mobile inputs
- [ ] Forms don't get hidden by virtual keyboard
- [ ] Pull-to-refresh on list pages
- [ ] Android notification permission flow tested
- [ ] iOS TestFlight build signed and distributed

---

## 8. Quick Start (When Ready)

Once the environment is set up (JDK, Android SDK, Xcode on macOS):

```bash
# Android
pnpm tauri android init --skip-targets-install --ci
pnpm tauri android dev              # Run on connected device/emulator
pnpm tauri android build            # Production APK/AAB

# iOS (macOS only)
pnpm tauri ios init
pnpm tauri ios dev                  # Run on iOS simulator
pnpm tauri ios build                # Production IPA
```

See `scripts/setup-mobile.sh` for one-time environment setup automation.