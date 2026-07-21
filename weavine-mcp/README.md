# weavine-mcp

MCP server (`stdio` JSON-RPC) wrapping weavine-server's REST API. Lets any
MCP client (Codex IDE/CLI, OpenCode, Claude Desktop) drive contacts,
events, actions, projects, and reminders through tool calls authenticated
by a long-lived `X-API-Key`.

## Quick start

```bash
# 1. Build the binary (release recommended for real use)
cargo build --release -p weavine-mcp
# → ./target/release/weavine-mcp

# 2. Bring up weavine-server (separate terminal)
DATABASE_URL=postgres://weavine:pass@127.0.0.1/weavine \
  cargo run --release -p weavine-server

# 3. Create an API key (one-time, plaintext shown only here):
curl -s -X POST http://127.0.0.1:8080/api/api_keys \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"codex"}'
# → {"id":"...","key":"wvk_...","name":"codex",...}

# 4. Configure your MCP client (see ../../../.codex/config.toml or
#    ../../../.opencode/mcp.json) with WEAVINE_API_KEY=wvk_...

# 5. From the MCP client, the tools are now available as `weavine.*`
#    e.g. `weavine.list_contacts({"limit": 10})`.
```

## Tiers

| Tier     | Trigger env                  | Tools |
|----------|------------------------------|-------|
| Default  | (unset) or `WEAVINE_MCP_TIER=default` | 32 (api_key, contact, event, action, project, reminder) |
| Full     | `WEAVINE_MCP_TIER=full`      | 58 (adds auth_jwt, diagnostic, tag, interaction, archive, setting, search, sync) |

Tier selection is per-process: change the env var and restart the MCP
server.

## Auth model

Every authenticated request sends `X-API-Key: <wvk_…>` on every call.
The server hashes incoming keys with argon2 against the `api_key` table
and resolves the owning user (matches `extract_auth` in
`server/src/handlers/auth.rs`). Keys are formatted as `wvk_<54
base62>` characters. Only argon2 hashes are stored — plaintext is shown
exactly once at create time.

Public tools (auth_register / auth_login / auth_logout / Tier 2) omit
the header so a key can be created before authentication exists.

## Configuration

| Env var              | Default                       | Notes |
|----------------------|-------------------------------|-------|
| `WEAVINE_BASE_URL`   | `http://127.0.0.1:8080`       | weavine-server origin |
| `WEAVINE_API_KEY`    | (empty)                       | `wvk_…` key. Omit for auth-only use. |
| `WEAVINE_MCP_TIER`   | `default`                     | `default` / `full` |
| `RUST_LOG`           | `info`                        | tracing-subscriber picks this up |

## Tools inventory

```
api_key (Tier 1)        list_api_keys / create_api_key / revoke_api_key
contact (Tier 1)        list / get / create / update / delete
event (Tier 1)          upcoming / list / get / create / update / delete
action (Tier 1)         list / get / create / update / delete
project (Tier 1)        list / get / create / update / delete /
                        list_project_contacts / add_project_contact /
                        remove_project_contact
reminder (Tier 1)       list / get / create / update / delete

auth_jwt (Tier 2)       auth_register / auth_login / auth_logout
diagnostic (Tier 2)     diagnostic_user / diagnostic_startup
tag (Tier 2)            list / create / update / delete
interaction (Tier 2)    list / get / create / update / delete
archive (Tier 2)        archive_summary / archive_counts / archive_list
                        / archive_unarchive_one / archive_bulk_unarchive
setting (Tier 2)        list_settings / upsert_setting / delete_setting
search (Tier 2)         search
sync (Tier 2)           sync_manifest / sync_push / sync_pull
```

Tool return types are the underlying JSON bodies from weavine-server.

## Smoke test

`docs/superpowers/smoke/mcp-smoke.sh` exercises the server end-to-end:
creates an api key, lists it, then revokes it — proving the round trip
works through both MCP and REST.

## Architecture

- `src/main.rs`             — stdio transport, env-load + tracing
- `src/config.rs`           — env-driven Config + Tier enum
- `src/error.rs`            — McpError (incl. From → rmcp::Error mapping)
- `src/client.rs`           — reqwest + X-API-Key + retry; post_public /
                              delete_with_body for endpoints needing them
- `src/server.rs`           — manual call_tool dispatch + list_tools;
                              Tier 1 always-on, Tier 2 opt-in
- `src/tools/api_key.rs`    — Tier 1 (3)
- `src/tools/contact.rs`    — Tier 1 (5)
- `src/tools/event.rs`      — Tier 1 (6)
- `src/tools/action.rs`     — Tier 1 (5)
- `src/tools/project.rs`    — Tier 1 (8)
- `src/tools/reminder.rs`   — Tier 1 (5)
- `src/tools/auth_jwt.rs`   — Tier 2 (3) — public
- `src/tools/diagnostic.rs` — Tier 2 (2)
- `src/tools/tag.rs`        — Tier 2 (4)
- `src/tools/interaction.rs`— Tier 2 (5)
- `src/tools/archive.rs`    — Tier 2 (5)
- `src/tools/setting.rs`    — Tier 2 (3)
- `src/tools/search.rs`     — Tier 2 (1)
- `src/tools/sync.rs`       — Tier 2 (3)
