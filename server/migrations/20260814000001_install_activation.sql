-- Migration 20260814000001: install_activation table
--
-- One row per unique install. The same UUID minted by the client on first
-- launch (typically `<data_dir>/install_id`) is sent as `X-Install-Id` on
-- every cloud request and ALSO becomes the `device_id` in the `devices`
-- table once the user logs in. This means a single UUID bridges the
-- anonymous track (this table) and the logged-in track (devices table),
-- so multi-device users can be detected by joining on user_id.
--
-- Privacy: `last_ip_hash` is SHA-256(JWT_SECRET || ip) — never raw IP. The
-- salt is the same JWT_SECRET already used for token signing, so no new
-- secret to manage.
--
-- Query examples are in docs/activation.sql.

CREATE TABLE IF NOT EXISTS install_activation (
    install_id     TEXT PRIMARY KEY,
    first_seen_at  TEXT NOT NULL,
    last_seen_at   TEXT NOT NULL,
    app_version    TEXT NOT NULL,
    os             TEXT NOT NULL,
    platform       TEXT NOT NULL,   -- 'desktop' | 'android' | 'web'
    last_ip_hash   TEXT NOT NULL,
    call_count     BIGINT NOT NULL DEFAULT 0,
    last_event     TEXT NOT NULL   -- 'launch' | 'ocr' | 'voice'
);

CREATE INDEX IF NOT EXISTS idx_install_activation_last_seen
    ON install_activation(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_install_activation_first_seen
    ON install_activation(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_install_activation_platform
    ON install_activation(platform);
