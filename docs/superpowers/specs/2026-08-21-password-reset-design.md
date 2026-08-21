# Password Reset — Implementation Design

**Status:** Implementing (yolo mode, user is away)
**Date:** 2026-08-21
**Branch:** `feature/password-reset`
**Scope:** server-side `forgot-password` / `reset-password` endpoints + minimal web SPA UI.

## Goal

A weavine user who forgot their password can request a reset link by email, then set a new password using that link. The link is single-use, expires, and forces re-login on every device.

## Decisions locked

| # | Item | Decision |
|---|------|----------|
| 1 | Token storage | New `password_reset_token` table. Token = 64-char random base62; column stores `blake_hash(token)` (same primitive as `refresh_token`). |
| 2 | Token lifetime | 60 minutes. |
| 3 | Single-use | Yes. `used_at` set on first successful reset; subsequent resets with the same token return 400. |
| 4 | Email transport | New `email` module with `EmailSender` trait. Default impl = `LogEmailSender` (`eprintln!` the link to stderr). Optional `SmtpEmailSender` activated by `SMTP_URL` env var. No external SMTP dep in v1 — use `lettre` only if SMTP is configured at runtime. |
| 5 | Link URL | `WEAVINE_RESET_URL_BASE` env var (default `http://localhost:5173/reset-password`). Appended with `?token=<raw>`. |
| 6 | Anti-enumeration | `forgot-password` always returns `200 {ok: true}` and sleeps a small random delay when the email is not found, so timing cannot leak existence. |
| 7 | Rate limit | 5 requests / email / hour, 20 / IP / hour. Stored in-process (DashMap keyed by `(route, scope, value)`); resets on restart — acceptable for v1. |
| 8 | Invalidate sessions | On successful reset, revoke every active `refresh_token` for that user. The user must re-login on every device. |
| 9 | Password rules | Same as register: ≥ 8 chars. |
| 10 | UI | Two new routes: `/forgot-password` (request) and `/reset-password` (consume token). Login page gains a "忘记密码？" link. |

## Schema

`server/migrations/20260821000001_password_reset.sql`

```sql
CREATE TABLE IF NOT EXISTS password_reset_token (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id    TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_user ON password_reset_token(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_expires ON password_reset_token(expires_at);
```

No sync triggers — this table is server-only, never pushed to clients.

## Server endpoints

### `POST /api/auth/forgot-password`

Body: `{email: string}`. Response: `200 {ok: true}` always (anti-enumeration).

Behavior:
1. Validate email format (return `ok` regardless).
2. If email exists, generate a 64-char base62 token; `INSERT` with `expires_at = now + 60min`.
3. If `EmailSender` is configured, send `{reset_link}` to the email.
4. Always return `ok: true` after a small randomized delay (uniform 80–250 ms) so timing is independent of the existence check.

### `POST /api/auth/reset-password`

Body: `{token: string, new_password: string}`. Response: `200 {ok: true}` on success, `400 {error: "..."}` otherwise.

Behavior:
1. Hash the supplied token.
2. `SELECT user_id, expires_at, used_at FROM password_reset_token WHERE token_hash = $1`.
3. Reject if not found, expired, or used.
4. `BEGIN; UPDATE user_account SET password_hash = $1, updated_at = $2 WHERE id = $3; UPDATE password_reset_token SET used_at = $2 WHERE id = $4; UPDATE refresh_token SET revoked_at = $2 WHERE user_id = $3 AND revoked_at IS NULL; COMMIT;`.
5. Return `ok: true`.

## Files to add / change

| File | Action |
|---|---|
| `server/migrations/20260821000001_password_reset.sql` | add |
| `server/src/email/mod.rs` | add (EmailSender trait + LogEmailSender + SmtpEmailSender) |
| `server/src/handlers/auth.rs` | add `forgot_password` + `reset_password` handlers |
| `server/src/rate_limit.rs` | add (small in-process limiter) |
| `server/src/handlers/mod.rs` | no change (auth.rs already a module) |
| `server/src/main.rs` | wire new routes + init email sender |
| `server/Cargo.toml` | add `lettre` optional under `smtp` feature |
| `apps/web-spa/src/routes/ForgotPassword.tsx` | add |
| `apps/web-spa/src/routes/ResetPassword.tsx` | add |
| `apps/web-spa/src/lib/auth/storage.ts` | add `requestPasswordReset` + `performPasswordReset` |
| `apps/web-spa/src/routes/Login.tsx` | add "忘记密码？" link |
| `apps/web-spa/src/routes-config.tsx` | register new routes |
| `apps/web-spa/src/styles.css` | add a small set of `.reset-*` styles (mirroring `.login-*`) |

## Rate limiter

`server/src/rate_limit.rs`:

```rust
pub struct RateLimiter { /* DashMap<(String, String), Vec<Instant>> */ }

impl RateLimiter {
    pub fn check(&self, route: &str, scope: &str, value: &str, limit: usize, window: Duration) -> bool
}
```

Sliding window per `(route, scope, value)` triple. Saves a fixed-size `Vec<Instant>` per key. Backed by `dashmap` (already a transitive dep via other crates? if not add it).

## Out of scope (v1)

- Tauri client (the desktop app uses local SQLite for auth, never the cloud password table — there's no password to reset there).
- Email templates / HTML body — plain text only.
- "Email not confirmed" gate — we don't have email confirmation in v1, so we don't add one here.
- Audit log of password resets — skip.
- UI password strength meter — copy the simple `minLength={8}` rule from Login.
