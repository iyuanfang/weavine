# Weavine MCP + API Key Auth — Implementation Design

**Status:** Draft (awaiting user approval)
**Date:** 2026-07-21
**Proposed branch:** `feature/mcp-api-key`
**Out of scope (v0.2.0c):** rate limiting, key rotation UI, key scoping (per-key permissions), MCP server hot-reload, MCP auth refresh flow, OAuth integration, bulk MCP-side caching.

## Goal

Let any MCP-compatible agent (OpenAI Codex CLI / IDE, OpenCode, Claude Desktop, …) perform full CRUD on weavine-server data, authenticated via a long-lived API key — without an MCP wrapper process in front of every other tool.

## Decisions locked

| # | Item | Decision |
|---|------|----------|
| 1 | Integration model | **MCP** (not REST Connectors) |
| 2 | MCP language | Rust (workspace member `weavine-mcp/`) |
| 3 | MCP transport | stdio JSON-RPC via `rmcp` SDK |
| 4 | MCP ↔ server | HTTP client + `X-API-Key` header |
| 5 | Server auth | New `api_key` table + 3 endpoints + middleware branch |
| 6 | Hash | argon2 (matches existing bcrypt posture) |
| 7 | Key prefix | `wvk_<54 base62 chars>` (54 = 324 bits entropy after 32-byte secret) |
| 8 | Tool surface | Tier 1 default (32 tools), Tier 2 opt-in via `WEAVINE_MCP_TIER=full` |
| 9 | Client config | Project-level `.codex/config.toml` + `.opencode/mcp.json` |

## Architecture

```
┌───────────────────────┐  stdio JSON-RPC  ┌────────────────────┐  HTTP + X-API-Key  ┌─────────────────────┐  sqlx   ┌──────────┐
│ Codex IDE / CLI       │ ◄───────────────► │ weavine-mcp        │ ─────────────────► │ weavine-server      │ ──────► │ Postgres │
│ OpenCode              │                  │ (Rust, rmcp SDK)   │ ◄───────────────── │ (axum + middleware) │         └──────────┘
│ Claude Desktop        │                  │ workspace member   │                    │                     │
│ (any MCP client)      │                  └────────────────────┘                    └─────────────────────┘
└───────────────────────┘
```

Two server-side changes; one new workspace member; handlers gain a 1-line call-site update (auth line only) — business logic untouched.

## Server-side changes

### Migration: `server/migrations/20260721000001_api_key.sql`

```sql
-- api_key: long-lived tokens for AI agent access
CREATE TABLE IF NOT EXISTS api_key (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id      TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL,                       -- argon2 hash of full key
    name         TEXT NOT NULL,                       -- human label, e.g. "codex-macbook"
    created_at   TEXT NOT NULL DEFAULT now()::TEXT,
    last_used_at TEXT,
    revoked_at   TEXT                                 -- NULL = active
);

CREATE INDEX IF NOT EXISTS api_key_user_id_idx ON api_key(user_id);
-- (no UNIQUE: one user may have multiple keys, e.g. one per device/agent)
```

**No sync triggers** — `api_key` is per-user local, not synced to devices.

### Handler: `server/src/handlers/api_key.rs`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET`    | `/api/api_keys`              | Bearer JWT | List current user's keys (no plaintext) |
| `POST`   | `/api/api_keys`              | Bearer JWT | Create new key; **returns plaintext once** |
| `DELETE` | `/api/api_keys/:id`          | Bearer JWT | Revoke (sets `revoked_at = now()`) |

**Request body for create:**

```json
{ "name": "codex-macbook" }
```

**Response (200):**

```json
{
  "id": "9f8a7b6c-...",
  "name": "codex-macbook",
  "key":  "wvk_<54chars>",      // ONLY shown here, never again
  "created_at": "2026-07-21T..."
}
```

**List response** omits `key`; returns `last_used_at` + `revoked_at` so the user can audit.

### Auth extension: make `extract_auth` async + DB-aware

Current signature at `server/src/handlers/auth.rs:115`:
```rust
pub fn extract_auth(headers: &HeaderMap) -> Result<String, (StatusCode, String)>
```
It's **sync** and stateless (JWT decode only). To support `X-API-Key` (which needs DB lookup + argon2 verify), we extend it:

```rust
pub async fn extract_auth(
    headers: &HeaderMap,
    pool: &PgPool,
) -> Result<String, (StatusCode, String)> {
    if let Some(api_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        // Fetch active keys and verify with argon2 (small N per user)
        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT id, user_id, key_hash FROM api_key
             WHERE revoked_at IS NULL",
        )
        .fetch_all(pool)
        .await?
        .into_iter()
        .find(|(_, _, hash)| {
            argon2::verify_encoded(hash, api_key.as_bytes()).unwrap_or(false)
        });

        if let Some((id, user_id, _)) = row {
            // Fire-and-forget last_used_at update
            let _ = sqlx::query("UPDATE api_key SET last_used_at = now()::TEXT WHERE id = $1")
                .bind(&id)
                .execute(pool)
                .await;
            return Ok(user_id);
        }
        return Err((StatusCode::UNAUTHORIZED, "invalid or revoked api key".into()));
    }

    // Existing JWT path — unchanged
    let token =
        extract_bearer(headers).ok_or((StatusCode::UNAUTHORIZED, "未登录".to_string()))?;
    let claims = verify_access(&token)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "token 无效或已过期".to_string()))?;
    Ok(claims.sub)
}
```

**Timing note**: the v1 fetch-all-and-verify approach is O(active_keys) per request. Acceptable since users typically have <10 keys. For production hardening, add a `lookup_hash` column (`encode(sha256(key), 'hex')`) and SELECT WHERE lookup_hash = $1, then argon2 verify the single row — O(1). Defer until active-key count grows.

**Call-site change (14 handlers, mechanical 1-liner):**

```diff
- let auth = extract_auth(&headers)?;
+ let auth = extract_auth(&headers, &pool).await?;
```

Handlers stay exactly the same otherwise — same return types, same business logic, same params. The user_id flowing through `let auth = ...` is identical for both auth methods.

### Server Cargo.toml — one new dep

```toml
argon2 = "0.5"
```

## MCP-side changes

### New crate: `weavine-mcp/`

```
weavine-mcp/
├── Cargo.toml
├── README.md
└── src/
    ├── main.rs               # rmcp::ServiceExt + stdio()
    ├── config.rs             # env loading
    ├── client.rs             # WeavineClient — reqwest + X-API-Key
    ├── error.rs              # McpError + Into<McpResult>
    └── tools/
        ├── mod.rs            # tool registry (Tier 1 + Tier 2)
        ├── auth_key.rs       # api_key CRUD
        ├── auth_jwt.rs       # (Tier 2) login/refresh/logout/me
        ├── contact.rs
        ├── event.rs
        ├── action.rs
        ├── project.rs
        ├── reminder.rs
        ├── interaction.rs    # (Tier 2)
        ├── tag.rs            # (Tier 2)
        ├── archive.rs        # (Tier 2)
        ├── setting.rs        # (Tier 2)
        ├── search.rs         # (Tier 2)
        ├── diagnostic.rs     # (Tier 2)
        └── sync.rs           # (Tier 2)
```

### `weavine-mcp/Cargo.toml`

```toml
[package]
name = "weavine-mcp"
version = "0.1.0"
edition = "2021"

[dependencies]
rmcp       = { version = "0.1", features = ["server", "macros"] }
reqwest    = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
serde      = { version = "1", features = ["derive"] }
serde_json = "1"
tokio      = { version = "1", features = ["macros", "rt-multi-thread"] }
anyhow     = "1"
thiserror  = "1"
tracing    = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
schemars   = "0.8"   # JSON Schema for #[tool] params
```

Add `"weavine-mcp"` to root `Cargo.toml [workspace] members`.

### Env contract

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `WEAVINE_MCP_BASE_URL` | yes | `http://127.0.0.1:8080` | weavine-server base URL |
| `WEAVINE_MCP_API_KEY`  | yes | — | Full api key including `wvk_` prefix |
| `WEAVINE_MCP_TIER`     | no  | `core` | `core` = Tier 1 only; `full` = Tier 1 + Tier 2 |
| `WEAVINE_MCP_TIMEOUT_MS` | no | `30000` | per-request HTTP timeout |
| `RUST_LOG` | no | `info` | tracing filter |

### Tool taxonomy

**Tier 1 (`core`, always exposed) — 32 tools**

| Group | Tools |
|-------|-------|
| api_key | `list_api_keys`, `create_api_key`, `revoke_api_key` (3) |
| contacts | `list_contacts`, `get_contact`, `create_contact`, `update_contact`, `delete_contact` (5) |
| events | `list_events`, `upcoming_events`, `get_event`, `create_event`, `update_event`, `delete_event` (6) |
| actions | `list_actions`, `get_action`, `create_action`, `update_action`, `delete_action` (5) |
| projects | `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`, `list_project_contacts`, `add_project_contact`, `remove_project_contact` (8) |
| reminders | `list_reminders`, `get_reminder`, `create_reminder`, `update_reminder`, `dismiss_reminder` (5) — **no `delete_reminder`** (default safe) |

**Tier 2 (`full`) — 30 more tools**

| Group | Tools | Why opt-in |
|-------|-------|-----------|
| auth JWT | `login`, `refresh_token`, `logout`, `me` (4) | MCP uses api_key, not JWT |
| diagnostic | `get_startup_info`, `get_current_user` (2) | Rarely needed for CRUD |
| tags | full CRUD (5) | Often managed via contact ops |
| interactions | full CRUD (5) | High volume, often filtered out |
| archive | all 6 ops (sweep, bulk_unarchive, …) | Write-heavy, dangerous |
| settings | `list_settings`, `upsert_setting`, `delete_setting` (3) | Sensitive |
| search | `search` (1) | Cheap but noise in tool picker |
| sync | `sync_manifest`, `sync_push` (2) | Mostly desktop-client domain |
| project_stages | `list_project_stages` (1) | Rare path |
| reminder delete | `delete_reminder` (1) | Moved out of Tier 1 for safety |

### Example tool pattern

```rust
// weavine-mcp/src/tools/contact.rs
use rmcp::tool;

#[tool(
    name        = "list_contacts",
    description = "List the current user's contacts. Optional limit (default 50, max 500).",
    annotations(read_only_hint = true, open_world_hint = false)
)]
pub async fn list_contacts(
    &self,
    #[tool(param)] limit: Option<u32>,
) -> Result<Vec<Contact>, McpError> {
    let limit = limit.unwrap_or(50).min(500);
    self.client.get("/api/contacts")
        .query(&[("limit", limit)])
        .send_json().await
}
```

Each tool group is a `#[tool_router]` impl block on a `Server` struct that holds the `WeavineClient`. `main.rs` wires them up:

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let cfg = WeavineMcpConfig::from_env()?;
    let client = WeavineClient::new(cfg.base_url, cfg.api_key, cfg.timeout_ms);
    let tier = Tier::from_env()?;
    let server = WeavineMcpServer::new(client, tier);
    server.serve(rmcp::transport::stdio()).await?;
    Ok(())
}
```

## Client configuration

### `.codex/config.toml` (Codex IDE / CLI)

```toml
[mcp_servers.weavine]
command = "cargo"
args    = ["run", "--quiet", "-p", "weavine-mcp"]
env     = { WEAVINE_MCP_BASE_URL = "http://127.0.0.1:8080", WEAVINE_MCP_API_KEY = "wvk_..." }
```

### `.opencode/mcp.json` (OpenCode)

```json
{
  "weavine": {
    "type": "local",
    "command": ["cargo", "run", "--quiet", "-p", "weavine-mcp"],
    "enabled": true,
    "environment": {
      "WEAVINE_MCP_BASE_URL": "http://127.0.0.1:8080",
      "WEAVINE_MCP_API_KEY": "wvk_..."
    }
  }
}
```

Both files are checked into the repo (gitignored for the api key) — `WEAVINE_MCP_API_KEY` is sourced from `.env` at boot via a wrapper script, or per-developer override.

### `.gitignore` additions

```
.codex/config.local.toml
.opencode/mcp.local.json
```

## Data flow — one call end-to-end

```
1. Agent invokes tool
   codex.callTool("list_contacts", {limit: 50})

2. MCP server (Rust process)
   Server::list_contacts(limit=50)
       └─ client.get("/api/contacts").query("limit", 50)
       └─ reqwest header: "X-API-Key: wvk_..."
       └─ HTTP GET → http://127.0.0.1:8080/api/contacts?limit=50

3. Server-side: handlers::contact::list(headers, State(pool), Query(p))
       let auth = extract_auth(&headers, &pool).await?;       // ← X-API-Key branch
       //   argon2 verify against all active api_key rows for this pool
       //   on match: UPDATE last_used_at = now(), return user_id
       //   on miss: fall through to JWT path
       //   on neither: 401
       let rows = sqlx::query_as("SELECT ... FROM contact WHERE user_id = $1 ...")
                    .bind(&auth)...

4. Response bubbles up → JSON body → reqwest → MCP → agent
```

**Auth failures**: 401 → MCP returns `McpError::auth("invalid or revoked api key")`. No retry.
**5xx / timeout**: MCP retries twice with exponential backoff (250ms → 1s), then surfaces error.

## Implementation order (rough 5-7 day plan)

| Day | Work |
|-----|------|
| 1 | Migration + `api_key` table + handler list/create/revoke + unit tests |
| 2 | `extract_auth` async + DB-aware, 14 call-site updates, integration tests (key + JWT both work) |
| 3 | New `weavine-mcp` crate skeleton + `WeavineClient` + 5 contact tools end-to-end |
| 4 | Remaining Tier 1 tools (events, actions, projects, reminders, api_key) |
| 5 | Tier 2 tools + tier gating |
| 6 | `.codex/config.toml` + `.opencode/mcp.json` + README + manual smoke |
| 7 | Polish: tracing, docs, optional Docker image of MCP for non-Rust hosts |

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Plaintext key in logs / config | (a) MCP never logs full key; (b) `.env` in `.gitignore`; (c) key shown only at creation |
| Key theft → full account takeover | `revoke_api_key` works instantly, no grace period |
| 62 tools bloat LLM context | Tier 1 default 32, Tier 2 opt-in 30 |
| `rmcp` SDK churn (v0.1) | Pin version; expect breakage, isolate behind thin wrapper |
| MCP-side key in process env | Same risk as any agent config; documented as accepted trade-off |
| 14-handler call-site sweep for `extract_auth` signature change | Mechanical diff (`?` → `.await?`, add `&pool` arg) — no logic change; swept in one Day-2 pass |

## Open questions

- **Refresh flow**: do we want MCP to be able to rotate its own key, or rely on human-in-loop? → defer
- **Per-key permissions**: today key == full user scope. Need a `scope` column later? → defer
- **HTTP transport option**: stdio only for v0.1, but rmcp supports HTTP/SSE. Worth a feature flag? → defer

## See also

- `AGENTS.md` — repo-wide architecture rules (server/sqlite boundary)
- `docs/superpowers/specs/2026-07-05-sync-engine-v0.2.0b-design.md` — sync v0.2.0b (precedent for sqlx + Postgres + middleware patterns)
