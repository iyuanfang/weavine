# Sync Engine v0.2.0b — Implementation Design

**Status:** Approved (设计已 OK + HTTPS 走 nginx)
**Date:** 2026-07-05
**Branch:** feature/sync-v0.2
**Out of scope:** Sub-Project 3 (Desktop SyncEngine 客户端)、Settings UI、后台调度、conflict UI、tombstone 清理 — 全部 defer 到 v0.2.0c/d。

## Goal

OPC 单用户跨设备同步(laptop / desktop / web)。同 row 离线改,LWW 合。

## Architecture

```
Desktop Tauri
  └─ weavine_lib::sync::SyncEngine (reqwest + RS256 verify + SQLite sync_meta)
       ↓ HTTPS POST /api/sync/{manifest,push,pull}
nginx :443 (Let's Encrypt) → axum :3000
  └─ weavine-server
       ├─ /api/sync/* (新) — manifest / push / pull
       ├─ /api/auth/*  — 改 RS256,加 device 注册
       └─ /api/{contacts,projects,...} — 14 张 domain 表
            ↓
       Postgres (weavine db)
         ├─ 14 domain 表 + server_revision + deleted_at + user_id (UUID)
         ├─ sync_meta / sync_manifest / sync_change_log / devices (新)
         └─ user_account / refresh_token (改 UUID + FK devices)
```

## Sync Protocol

### 端点

| Method | Path | Auth | 用途 |
|--------|------|------|------|
| POST | `/api/sync/manifest` | Bearer JWT | 取 server_revision watermark |
| POST | `/api/sync/push` | Bearer JWT | 上传本地变更 |
| POST | `/api/sync/pull` | Bearer JWT | 拉取远端变更 |

### Manifest

```http
POST /api/sync/manifest {}
→ 200 { schema_version, server_revision, last_updated }
```

### Push

```http
POST /api/sync/push
{
  "since_revision": 12340,
  "device_id": "uuid",
  "entities": [
    { "kind": "contact", "rows": [ { "id": "uuid", "name": "Alice", "updated_at": "..." } ] },
    { "kind": "action", "rows": [...] }
  ]
}
→ 200 {
  "applied": [ { "kind", "row_id", "new_revision" } ],
  "conflicts": [ { "kind", "row_id", "reason": "outdated|tie_409", "server_updated_at" } ],
  "server_revision": 12345
}
```

**LWW 规则(per row):**
- `payload.updated_at > server.updated_at` → accept, bump `server_revision`, return `applied`
- `payload.updated_at < server.updated_at` → reject, return `conflicts[].reason="outdated"`,客户端保留本地版本,下次 pull 拿服务端权威版
- `payload.updated_at == server.updated_at`(毫秒撞车) → return `conflicts[].reason="tie_409"`,客户端 re-pull + re-push 即可
- **Server 永不抛 HTTP 409**,所有 conflict 走 `conflicts[]` 数组返回,HTTP status 永远 200

### Pull

```http
POST /api/sync/pull
{ "since_revision": 12340, "limit": 500 }
→ 200 {
  "rows": [ { "kind", "op": "upsert|delete", "row_id", "data", "revision" } ],
  "latest_revision": 12345,
  "has_more": false
}
```

分页:如果 `rows.length == limit`,client 设 `since_revision = latest_revision` 再 pull。`has_more=true` 表示还有下一页。

### 15 个 entity kind

`contact`, `tag`, `contact_tag`, `project`, `project_contact`, `event`, `action`, `interaction`, `reminder`, `setting`, `user_account`, `refresh_token`, `device`, `sync_meta`, `sync_manifest` — 每个 JSON shape 对应 Postgres 行。

## Database Schema

### 4 张新表

```sql
-- 单例:每个用户一行,本地 watermark
CREATE TABLE sync_meta (
  user_id                UUID PRIMARY KEY REFERENCES user_account(id),
  server_revision        BIGINT NOT NULL DEFAULT 0,
  last_pulled_revision   BIGINT NOT NULL DEFAULT 0,
  schema_version         INT NOT NULL DEFAULT 1,
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Latest revision watermark(读这个比 SELECT MAX(revision) FROM sync_change_log 快)
CREATE TABLE sync_manifest (
  user_id          UUID PRIMARY KEY REFERENCES user_account(id),
  schema_version   INT NOT NULL DEFAULT 1,
  server_revision  BIGINT NOT NULL DEFAULT 0,
  last_updated     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Audit trail(每次服务端写一行)
CREATE TABLE sync_change_log (
  revision    BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES user_account(id),
  device_id   UUID NOT NULL REFERENCES devices(id),
  entity_kind TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  data        JSONB,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX sync_change_log_user_rev ON sync_change_log (user_id, revision);

-- 每设备一行
CREATE TABLE devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_account(id),
  name          TEXT NOT NULL,
  os            TEXT NOT NULL,
  app_version   TEXT NOT NULL,
  last_seen_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX devices_user_id ON devices (user_id);
```

### 14 张 domain 表改 schema(A 选项:全 spec 对齐)

每张表:
- `RENAME COLUMN owner_id TO user_id`
- `ALTER COLUMN user_id TYPE UUID USING user_id::UUID`
- `ADD COLUMN server_revision BIGINT NOT NULL DEFAULT 1`
- `ADD COLUMN deleted_at TIMESTAMP`(soft-delete tombstone)

### user_account + refresh_token 重建

```sql
DROP TABLE IF EXISTS refresh_token;
DROP TABLE IF EXISTS user_account;

CREATE TABLE user_account (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  server_revision BIGINT NOT NULL DEFAULT 1,
  deleted_at      TIMESTAMP
);

CREATE TABLE refresh_token (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES user_account(id),
  device_id   UUID NOT NULL REFERENCES devices(id),
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  revoked_at  TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX refresh_token_token_hash ON refresh_token (token_hash);
```

## Triggers

单个 trigger function 复用 14 张表:

```sql
CREATE SEQUENCE IF NOT EXISTS server_revision_seq START 1;

CREATE OR REPLACE FUNCTION sync_log_change() RETURNS TRIGGER AS $$
DECLARE
  v_user_id   UUID;
  v_device_id UUID;
  v_kind      TEXT := TG_TABLE_NAME;
  v_row_id    TEXT;
  v_op        TEXT;
  v_data      JSONB;
BEGIN
  -- Server 在每次写之前 SET LOCAL app.current_device_id
  BEGIN
    v_device_id := current_setting('app.current_device_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_device_id := NULL;
  END;

  IF (TG_OP = 'INSERT') THEN
    v_op := 'upsert'; v_user_id := NEW.user_id; v_row_id := NEW.id; v_data := to_jsonb(NEW);
  ELSIF (TG_OP = 'UPDATE') THEN
    v_op := CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete' ELSE 'upsert' END;
    v_user_id := NEW.user_id; v_row_id := NEW.id; v_data := to_jsonb(NEW);
  ELSIF (TG_OP = 'DELETE') THEN
    v_op := 'delete'; v_user_id := OLD.user_id; v_row_id := OLD.id; v_data := NULL;
  END IF;

  IF v_device_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);  -- 没设 device_id 就跳过(日志告警)
  END IF;

  INSERT INTO sync_change_log (user_id, device_id, entity_kind, row_id, op, data, created_at)
  VALUES (v_user_id, v_device_id, v_kind, v_row_id, v_op, v_data, NOW());

  NEW.server_revision := nextval('server_revision_seq');
  UPDATE sync_manifest SET server_revision = NEW.server_revision, last_updated = NOW()
    WHERE user_id = v_user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_log_contact          AFTER INSERT OR UPDATE OR DELETE ON contact          FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_tag              AFTER INSERT OR UPDATE OR DELETE ON tag              FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_contact_tag      AFTER INSERT OR UPDATE OR DELETE ON contact_tag      FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_project          AFTER INSERT OR UPDATE OR DELETE ON project          FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_project_contact  AFTER INSERT OR UPDATE OR DELETE ON project_contact  FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_event            AFTER INSERT OR UPDATE OR DELETE ON event            FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_action           AFTER INSERT OR UPDATE OR DELETE ON action           FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_interaction      AFTER INSERT OR UPDATE OR DELETE ON interaction      FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_reminder         AFTER INSERT OR UPDATE OR DELETE ON reminder         FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_setting          AFTER INSERT OR UPDATE OR DELETE ON setting          FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER sync_log_push_subscription AFTER INSERT OR UPDATE OR DELETE ON push_subscription FOR EACH ROW EXECUTE FUNCTION sync_log_change();
```

**Server 契约:** 每次 domain write 前 handler `SET LOCAL app.current_device_id = '<uuid>'`。trigger 读这个 session 变量,没设就跳过 sync_change_log 写入并 stderr 告警。

## Auth + Devices

### JWT RS256(替换 HS256)

**Key 生成**(一次性,prod 上):
```bash
cd /www/weavine
openssl genpkey -algorithm RSA -out jwt-private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
chmod 600 jwt-private.pem
```

**环境变量**(systemd unit Environment= 或 .env):
```
JWT_PRIVATE_KEY_PATH=/www/weavine/jwt-private.pem
JWT_PUBLIC_KEY_PATH=/www/weavine/jwt-public.pem
JWT_ACCESS_TTL_SECS=604800    # 7 days
JWT_REFRESH_TTL_SECS=2592000  # 30 days
```

**Server:** 启动时读 PEM,缓存 EncodingKey + DecodingKey。`algorithm = Algorithm::RS256`。

**Desktop client:** public key 嵌入 `weavine_lib::sync::keys.rs` 常量。0b 暂时不验(都是在线请求),但基础设施 ready for 0c 离线验证。

### Auth endpoint 改动

- `POST /api/auth/register`: body 加 `{device: {name, os, app_version}}`。创 user_account + devices + refresh_token(关联 device)。返回 `{access_token, refresh_token, user_id, device_id}`。
- `POST /api/auth/login`: 同上。每次 login 创**新** device 行(2 次登录 = 2 个 device)。spec §4.1 限 10 device — **0b 放宽:不强制,> 10 时 stderr warn**。
- `POST /api/auth/refresh`: 按 token_hash 找,验 not revoked + not expired + device 存在。换新 access token(同 device)。
- `POST /api/auth/logout`: refresh_token.revoked_at = NOW()。device 保留(用户可重新登录)。
- `GET /api/auth/me`: 返回 `{user_id, email, devices: [{id, name, os, last_seen_at}]}`。

### Sync endpoint auth

3 个 sync 端点都要 `Authorization: Bearer <jwt>`。JWT.sub = user_id (UUID as string)。handler 强制 `WHERE user_id = $1`,client 传 user_id 也忽略。

## Deployment + HTTPS

- **不动 nginx 拓扑。** 已有的 `https://ai.financialagent.cc → axum :3000` 链路复用。
- `/api/sync/*` 走同一条 HTTPS 路径。
- nginx 配置**不改**(如果 user 要"公网字面不可达",再加 `location /api/sync/ { allow <internal-ip>; deny all; }`,但默认不加)。
- JWT 鉴权足够防外网爬虫。`/api/sync/*` 不进任何公开 API 文档,只 desktop client 知道。
- Desktop 用 `https://ai.financialagent.cc/api/sync/*`(同域名)。Local dev 用 `http://localhost:3000`。

## 数据迁移(v0.2.0a → v0.2.0b)

DB 当前**完全空**(v0.2.0a 部署时已清理)。所以:

1. DROP user_account + refresh_token(空表,无风险)
2. 跑新 migration 文件(创所有表 + 加 server_revision/deleted_at/user_id UUID 改类型)
3. 创 4 张新表 + 14 triggers
4. 不需要 data migration

## Open Questions / Deferrals

- **Conflict UI** (0d): tie_409 时弹窗让用户选?先 log,以后 UI 再说。
- **Tombstone cleanup** (0d): sync_change_log 无限增长?90 天 TTL?Snapshot-prune?先不定,数据多了再说。
- **Background sync scheduler** (0d): 现在 desktop 启动时 pull 一次,退出时 push 一次。生产要加定时器。
- **Settings UI link/unlink** (0d): 桌面端没 UI 让用户主动 enroll/解绑设备。当前靠 register/login 副作用创 device。
- **Desktop SyncEngine** (0c,单独 spec): Rust reqwest 客户端 + 本地 SQLite sync_meta 表 + 启动 hook。这是 Sub-Project 3。
- **First-link UX** (0c): desktop 第一次跑 → 弹 QR/code 让用户在 web 端授权?Or 直接 login?UI 没定。
- **HTTPS literal restriction** (user 待确认): 我按"不改 nginx"写了。如果 user 真要"公网字面不可达",我在 nginx 加 IP 白名单就行。

## 实施步骤概要(后续 writing-plans 详写)

1. 本地生成 RSA keypair + 放 .env
2. migration 文件写完整(4 新表 + 14 domain 改 + 14 trigger + user_account/refresh_token 重写)
3. server/Cargo.toml 加 jsonwebtoken 0.12(已加) + 改 algorithm
4. server/src/handlers/auth.rs 改 RS256 + 创 device + refresh_token.device_id FK
5. server/src/handlers/sync.rs 新文件 — manifest/push/pull 3 个 handler
6. server/src/db.rs 加 `set_device_id(pool, device_id)` helper(handler 每次写前调)
7. server/src/main.rs wire 3 个 sync 路由 + me endpoint 加 devices 列表
8. server 端 build + 部署(rustc 1.88.0 server-side,glibc 2.32)
9. smoke test: register + login + manifest + push + pull 端到端
10. **不动** desktop,不动 SPA — 这版纯 server 改