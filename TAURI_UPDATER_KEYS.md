# Tauri Updater Signing Credentials

Generated: 2026-06-28
Purpose: Sign Weavine Tauri updater releases

## Files
- Private key (raw 32-byte ed25519): `~/.tauri/weavine.key`
- Public key (paste in `src-tauri/tauri.conf.json`): `kMX9WgTNpGW968GReA54XzcvIauj9vVjZfG6Wk0w8/E=`
- Password: `weavine-updater-2026`

## Set GitHub Secrets (https://github.com/iyuanfang/weavine/settings/secrets/actions)

| Secret name | Value |
|-------------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | `zCPJA+Y3B7mLRHU2yvtDLdZh+/wh8HhMNrONdFfpsDw=` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `weavine-updater-2026` |

⚠️ **Important**:
- Never commit the private key file to git
- The base64 string in the secret value should NOT include newlines
- If you regenerate, update both the public key in tauri.conf.json AND the GitHub secret

## How Tauri's tauri-action uses these

In `.github/workflows/release.yml`:
```yaml
env:
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

The action:
1. Decodes the base64 private key
2. Decrypts with the password
3. Signs the `latest.json` updater manifest with the private key
4. Embeds the public key in the binary (matches the one in tauri.conf.json)
5. Tauri clients verify the signature on download using the embedded public key

## Regenerating

```bash
rm ~/.tauri/weavine.key
python3 scripts/generate-tauri-key.py  # or whatever you wrap it in
# Then re-update both tauri.conf.json AND the GitHub secret
```
