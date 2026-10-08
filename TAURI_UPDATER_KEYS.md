# Tauri Updater Signing Credentials

Current key (rotated 2026-09-27, used since v1.7.2):

- Private key file: `C:/Users/admin/.tauri/weavine-updater-pw.key`
- Public key (embedded in `src-tauri/tauri.conf.json`): key id `55EE5B66B50379ED`
  (base64 in conf: `dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU1RUU1QjY2QjUwMzc5RUQK...`)
- Password: `weavine2026`
- Local signing: `pnpm exec tauri signer sign -f C:/Users/admin/.tauri/weavine-updater-pw.key -p weavine2026 <file>`
  → writes `<file>.sig` next to the input; the file content (base64 of the
  minisign sig) is what goes into `latest.json`'s `signature` field.

Older keys in `~/.tauri/` (do not use — they do NOT match the embedded pubkey):

| File | Key id | Note |
|------|--------|------|
| `weavine.key` | 170E94A0666D5ED6 | 2026-06 raw-ed25519 era, documented in the June version of this file |
| `weavine-updater.key` | C99F9AEA5A315BAA | unused |
| `weavine-updater-pw.key` | **55EE5B66B50379ED** | ← current |

## GitHub Secrets (https://github.com/iyuanfang/weavine/settings/secrets/actions)

| Secret name | Value |
|-------------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `weavine-updater-pw.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `weavine2026` |

⚠️ **Important**:
- Never commit the private key file to git
- The base64 secret value should NOT include newlines
- If you regenerate, update BOTH the pubkey in `tauri.conf.json` AND the GitHub
  secret — otherwise released clients (which embed the old pubkey) can no
  longer verify updates.

## CI signing (since v1.7.10)

`tauri.conf.json` now sets `bundle.createUpdaterArtifacts: true`. With the
secrets above present, `tauri build --bundles nsis,updater` emits
`*.exe.sig` / `*.AppImage.sig` / `*.app.tar.gz.sig` next to the bundles;
`.github/workflows/release.yml` uploads them to the GitHub release and
`update-manifest.yml` assembles `latest.json` from them after publish.

Before v1.7.10, CI produced NO signatures (flag missing) — manifests were
assembled by hand: sign locally with the command above, paste the `.sig`
content into `latest.json`, scp to `wy:/home/ubuntu/weavine/www-downloads/`.
