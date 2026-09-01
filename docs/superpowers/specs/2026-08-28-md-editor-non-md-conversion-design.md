# MD Editor + Non-MD Conversion (v1.3.6 → v1.3.7)

**Status:** SHIPPED (v1.3.6 + v1.3.7, 2026-08-28)
**Scope:** Desktop .md file editor, in-place external-file converter, Settings surface trim, quick-capture shortcut rebind.
**Branch / commits:** `1dd37e7` (Phase 1 conversion + encoding preservation + external-change detection) → `4964ae4` (Android gate).

## Goal

Two related features that share the .md editor route:

1. **MD editor** — open any `.md` file on disk in `apps/web-spa/src/routes/MdEditor.tsx`, edit, save. Round-trips the original encoding (UTF-8 / UTF-8 with BOM / GBK / GB18030). Detects external modification on reopen and offers a one-click reimport into the note library.
2. **Non-MD conversion (Phase 1)** — open `.docx / .pdf / .html / .xlsx / .pptx / .txt` and convert to markdown via `markitdown`; write the converted markdown as a sibling `<name>.md` next to the original; never overwrite the binary source.

Desktop-only (macOS / Windows / Linux). Android and Web stub the entire feature.

## Architectural decisions

| # | Item | Decision |
|---|------|----------|
| 1 | Editor surface | Tauri native open/save dialogs (`tauri-plugin-dialog`); web-spa editor route (`/md-editor?path=…&external_path=…`) |
| 2 | Encoding | Probe via `chardetng`, decode via `encoding_rs`. Preserve original on save. UTF-8 BOM is the round-trip marker for "this is UTF-8 text that came from Windows" |
| 3 | External-change detection | `MdImportStatus.file_mtime_unix_ms` vs `imported_at`; `reimport_needed = file_exists && file_mtime > imported_ms`. UI shows a warning banner with a single-click `importToLibrary({mode: 'update'})` |
| 4 | Non-MD converter | `markitdown = "0.1"` (`uhobnil/markitdown-rs`, MIT/Apache). Plain-text fallback when no converter matches. Source SHA-1 (`sha2::Sha256` — `sha2 0.10` dropped `Sha1`) and mtime are recorded for future re-convert detection |
| 5 | Convert result layout | `ConvertResult { markdown, source_format, source_sha1, source_mtime_unix_ms, fallback_used, fallback_reason }` |
| 6 | Sibling file naming | `<dir>/<basename_without_ext>.md`. Pre-existing sibling → caller decides (we currently overwrite; future: prompt) |
| 7 | Settings surface | Drop `ReminderSoundCard` + kv-store UI (unused). Gate `API 密钥` header button to `isWebRuntime`. New `ConvertFormatsPanel` shows supported formats (Tauri only) |
| 8 | Quick-capture shortcut | Rebind from `Ctrl+K` to bare `\` (no modifier). Desktop uses `tauri-plugin-global-shortcut` with `with_shortcuts(["Backslash"])`; web-spa mirrors the same key as a plain `keydown` listener using bubble phase + skip input/textarea/contentEditable (same pattern as `/` search) |
| 9 | Android exclusion | `cfg(not(target_os = "android"))` on `md_editor` + `convert` modules + 14 invoke_handler entries; `markitdown` lives in `[target.cfg(not(target_os = android)).dependencies]`. JS adapter stubs `md.*` with `Promise.reject("Android 暂不支持 .md 编辑器")` |

## Why Android is excluded (the openssl-sys cliff)

`markitdown = "0.1"` transitively pulls `rig-core ^0.8.0 → reqwest 0.11.27 (native-tls default) → openssl-sys 0.9.117`. Cross-compiling `openssl-sys` for `aarch64-linux-android` requires libssl-dev on the runner, which the GitHub Actions ubuntu image does not install. The failure surfaces as:

```
error: failed to run custom build command for `openssl-sys v0.9.117`
```

Verified after the `1dd37e7` CI run. Fix: gate the whole feature out on Android (commit `4964ae4`). Verified via `cargo tree --target aarch64-linux-android`: **zero** hits for `markitdown / openssl / openssl-sys / rig-core`.

The regression-prevention comments on the cfg gates (`md_editor.rs`, `convert.rs`, `Cargo.toml`) document this chain — without them a future maintainer will naively move `markitdown` back to top-level deps and re-trigger the CI failure.

## File map

```
src-tauri/
├── Cargo.toml                                          ← markitdown moved to [target.cfg(not(target_os = android)).dependencies]
├── src/
│   ├── lib.rs                                          ← pub mod + 14 invoke_handler entries cfg-gated
│   ├── md_editor.rs                                    ← #![cfg(not(target_os = android))], encoding preserve, external-change
│   └── convert.rs                                      ← #![cfg(not(target_os = android))], markitdown + plain-text fallback

apps/web-spa/src/
├── lib/adapter/
│   ├── types.ts                                        ← MdImportStatus.file_exists, ConvertResult, ConvertFormatInfo, ConvertSourceFormat
│   ├── tauri.ts                                        ← TauriAdapter.isAndroidTauri static + androidMdStub
│   └── http.ts                                         ← web stubs (reject convert; [] for formats)
├── routes/
│   ├── MdEditor.tsx                                    ← external_path URL param, convert banner, reimport banner, reconvertFromSource
│   └── Settings.tsx                                    ← drop ReminderSoundCard + kv-store UI; ConvertFormatsPanel; API 密钥 web-only
├── App.tsx                                             ← bare \ listener (mirrors /) + useGlobalShortcut desktop fallback
├── components/AppShell.tsx                             ← shortcutLabel() returns "\\"
└── hooks/useGlobalShortcut.ts                          ← parses ctrl+k / ctrl+shift+k / bare \\; isTypingTarget() guard

src-tauri/src/lib.rs:274                                ← with_shortcuts(["Backslash"]) (was CommandOrControl+K)
```

## Data flow

```
USER opens a .docx file
  │
  ▼ open_md_dialog() (Tauri dialog with 8 friendly filters)
  │
  ▼ .docx selected → setParams({ path: <dir>/foo.md, external_path: <dir>/foo.docx })
  │
  ▼ MdEditor useEffect:
  │   r = await convertExternalFile(external_path)
  │   setContent(r.markdown)
  │   setConvertMeta({ source_format, source_sha1, source_mtime_unix_ms, fallback_used })
  │
  ▼ User edits, hits Ctrl+S → adapter.md.writeFile(path, content, encoding)
  │     (path = sibling .md; original binary untouched)
  │
  ▼ Optional: "导入库" → importToLibrary({ mode: 'create' | 'update' })
```

## Reconvert-detection (planned, deferred)

When a user edits a converted `.md`, the source binary is untouched. If they later edit the `.docx` and want a fresh conversion, the current UI offers a `重新转换` button that **discards current unsaved changes and reruns conversion**. A future iteration could auto-detect via stored `source_sha1` vs current file sha1 + show a "源文件已变更，请重新转换" banner similar to the external-edit reimport banner. Tracked as v1.3.8 candidate.

## Known limitation: Android voice recognition "yeah" hallucination (deferred)

`apps/web-spa/src/lib/voice.ts::recordAudio` uses `AnalyserNode` RMS energy VAD only — no WebRTC VAD, no min recording duration, no trailing-silence padding before `sherpa-onnx::accept_waveform`. Worst-case tap-mic → ~576 ms silence → stop → ~800 ms clip → SenseVoice hallucinates "yeah" / "你好" / "thanks for watching".

Proposed defensive layering (NOT YET IMPLEMENTED — see commit `4964ae4` for the parallel fix):

1. `voice.ts::maybeStop` — ignore `'silence'` if `Date.now() - startTime < 1500` (hard min 1.5 s)
2. `silenceFramesNeeded` → `60` (~960 ms instead of ~576 ms)
3. `silenceRms` → `0.008` (tighter than current 0.012 for noisy environments)
4. Server `voice.rs` — reject `pcm.len() < 8000` (~0.5 s @ 16 kHz)
5. Server — pad trailing ~300 ms silence before `stream.accept_waveform()` so SenseVoice's LM sees a clean end-of-utterance signal

## Settings page final surface (post v1.3.6)

| Panel | Render condition | Purpose |
|-------|------------------|---------|
| `CloudSyncPanel`     | Tauri only | Login / logout / immediate sync; rate-limited; Android-sideload hint for APK upgrades |
| `ArchivePanel`       | always      | Auto-archive rules + bulk-restore buttons |
| `BackupRestorePanel` | always      | Full JSON export / import (legacy Next.js export compatible) |
| `ConvertFormatsPanel`| Tauri only  | Supported non-`.md` formats as badges |
| API 密钥 link in header | **Web only** (`isWebRuntime`) | Cloud API key CRUD lives on `/settings/api-keys` |

## Test coverage

| Surface | Test | Status |
|---------|------|--------|
| `md_editor::write_md_file` | round-trip UTF-8 / UTF-8 BOM / GBK / GB18030 | ✅ unit |
| `convert::read_as_markdown` | markitdown success + plain-text fallback + unsupported ext rejection | ✅ unit |
| `convert::sibling_md_path` | `<dir>/foo.docx` → `<dir>/foo.md` | ✅ unit |
| `md_editor::md_check_import_status` | mtime comparison + `reimport_needed` | ✅ unit |
| Android exclusion | `cargo tree --target aarch64-linux-android` — zero openssl/rig-core | ✅ verified |
| TypeScript | `pnpm typecheck` clean | ✅ |
| Rust | `cargo check` clean (host) | ✅ |

## See also

- `AGENTS.md` — repo-wide architecture rules
- `docs/superpowers/specs/2026-08-23-roadmap-v1.1.0.md` — prior shipped work + v1.2.0 plan
- `apps/web-spa/src/lib/voice.ts` — voice recording pipeline with the deferred VAD hardening notes