-- 2026-08-20 Per-device API key for anonymous OCR/voice auth.
--
-- Replaces the shared `WV_SERVICE_KEY` model on the anonymous path. Each
-- install gets a unique UUID hex key minted by the server on the first
-- `POST /api/activation/ping`. The client persists it to
-- `<data_dir>/device_key` (Tauri) or `localStorage[weavine:device_key]`
-- (web) and sends it on every cloud call as `X-Device-Key`.
--
-- device_key      UUID hex (32 chars); new installs get one on first ping.
-- plan            (forward, 1.0.4+) 'free' | 'trial' | 'pro'
-- daily_ocr_count (forward, 1.0.4+) running total of OCR calls today
-- daily_voice_count (forward, 1.0.4+) same for voice
-- daily_reset_at  (forward, 1.0.4+) start of counter window
-- revoked_at      soft-revoke (NULL = active)

ALTER TABLE install_activation ADD COLUMN IF NOT EXISTS device_key TEXT;
ALTER TABLE install_activation ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE install_activation ADD COLUMN IF NOT EXISTS daily_ocr_count INT NOT NULL DEFAULT 0;
ALTER TABLE install_activation ADD COLUMN IF NOT EXISTS daily_voice_count INT NOT NULL DEFAULT 0;
ALTER TABLE install_activation ADD COLUMN IF NOT EXISTS daily_reset_at TEXT;
ALTER TABLE install_activation ADD COLUMN IF NOT EXISTS revoked_at TEXT;

UPDATE install_activation
SET device_key = encode(sha256(('weavine-v1-device-key:' || install_id)::bytea), 'hex')
WHERE device_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_install_activation_device_key
    ON install_activation(device_key) WHERE device_key IS NOT NULL;
