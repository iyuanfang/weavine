# #3 关系模型重构 — 事件多人（Entity Links 第一阶段）

> 日期：2026-08-07 ｜ 状态：设计中
> 依据：`Weavine-产品需求Spec.md` §3.2 + §4 + `AGENTS.md`
> 范围：**事件多人 only**（events ↔ contacts via `entity_links`）。本阶段不含：
>   - 项目端 `project_contact` 对齐到 `entity_links` 的 `involved` 边（已实现，不动）
>   - 联系人间 `contact ↔ contact` 直接边（图谱底座，留作 #4 一并设计）
>   - 待办（actions）单人改造（spec §3.2 已澄清 actions 单人，无需改）

---

## 1. 目标与价值

把"事件只能挂 1 个 contact"的单外键升为"事件可挂 ≥2 个 contact、各带角色"，为后续 #4 关系图谱提供边表（`entity_links`）。本阶段只为 #3 事件侧，不引入图谱交互。

**收益**
- 一次会面/活动记多人角色（organizer/participant/referred/mentioned）
- 同一联系人可在多个事件里扮演不同角色
- `entity_links` 表作为未来图谱边表的容器（先建不冲突的最小列 + UNIQUE 约束）

**非目标（明确推迟）**
- 不动 `project_contact`（已实现的 joined table）
- 不建 `contact ↔ contact` 边
- 不实现事件↔事件、事件↔项目的边
- 不改 reminder 触发逻辑（reminder 仍然按 `event.contact_id` 走；reminder 多人群发留 P2）

---

## 2. 数据模型

### 2.1 新表 `entity_links`

**SQLite（desktop, `src-tauri/src/migration.rs`）：**

```sql
CREATE TABLE IF NOT EXISTS "EntityLink" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "user_id"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "from_type"     TEXT NOT NULL CHECK (from_type IN ('contact','event','action','project','interaction')),
    "from_id"       TEXT NOT NULL,
    "to_type"       TEXT NOT NULL CHECK (to_type IN ('contact','event','action','project','interaction')),
    "to_id"         TEXT NOT NULL,
    "relation_type" TEXT NOT NULL CHECK (relation_type IN ('participated','involved','regards')),
    "role"          TEXT NOT NULL DEFAULT 'participant',
    "created_at"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("user_id","from_type","from_id","to_type","to_id","relation_type")
);
CREATE INDEX IF NOT EXISTS "ix_entity_link_event"   ON "EntityLink"("from_id") WHERE from_type='event';
CREATE INDEX IF NOT EXISTS "ix_entity_link_contact" ON "EntityLink"("to_id")   WHERE to_type='contact';
```

**Postgres（server, 新 migration `20260807000001_entity_links.sql`）：**

```sql
CREATE TABLE IF NOT EXISTS entity_links (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    from_type       TEXT NOT NULL CHECK (from_type IN ('contact','event','action','project','interaction')),
    from_id         TEXT NOT NULL,
    to_type         TEXT NOT NULL CHECK (to_type IN ('contact','event','action','project','interaction')),
    to_id           TEXT NOT NULL,
    relation_type   TEXT NOT NULL CHECK (relation_type IN ('participated','involved','regards')),
    role            TEXT NOT NULL DEFAULT 'participant',
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, from_type, from_id, to_type, to_id, relation_type)
);
CREATE INDEX ix_entity_link_event   ON entity_links (from_id) WHERE from_type = 'event';
CREATE INDEX ix_entity_link_contact ON entity_links (to_id)   WHERE to_type = 'contact';
CREATE INDEX ix_entity_link_rev    ON entity_links (user_id, server_revision);

CREATE TRIGGER entity_link_sync
BEFORE INSERT OR UPDATE OR DELETE ON entity_links
FOR EACH ROW EXECUTE FUNCTION emit_sync_change();
```

### 2.2 字段语义

- `from_type='event'` + `to_type='contact'` + `relation_type='participated'` 即 事件—参与者边（本期唯一活跃用法）
- `role` 本期允许值：`organizer | participant | referred | mentioned`（默认 `participant`）
- 未来的 `involved`（项目-人）和 `regards`（待办-人）schema 允许但 UI/handler 不暴露

### 2.3 现有字段：保留 `event.contact_id`

**不 drop** `event.contact_id`。理由：
- `reminder`/`interaction` 仍需要至少一个联系人定位触发对象
- 单 drop 字段 = backfill 复杂 + UI 解析全改 = 高风险
- 保留 `event.contact_id` 作为"主参与者"（事件创建时第一个 participant 同步写入），同时 `entity_links` 持有全部参与者列表

`event.contact_id` 在本期成为 **derived 列**：事件创建/编辑时由 `entity_links` 的 `participant` 自动同步写入。代码约束保证两者一致（应用层在事务内同步）。

### 2.4 共享模型（`weavine_lib::models`）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityLink {
    pub id: String,
    pub user_id: String,
    pub from_type: String,
    pub from_id: String,
    pub to_type: String,
    pub to_id: String,
    pub relation_type: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}
```

只加最小 derive 集合（`Debug, Clone, Serialize, Deserialize`），复用现有 `cfg_attr` 模式给 rusqlite/sqlx。

---

## 3. API 表面

### 3.1 服务端（axum）

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET`    | `/api/events/:id`                  | 现有；响应体增 `participants: [{contact_id, role}]` |
| `GET`    | `/api/events/:id/participants`     | 列出事件参与者 |
| `POST`   | `/api/events/:id/participants`     | body `{contact_id, role}` 增一个参与者（重复则 409；event 不存在 404） |
| `PATCH`  | `/api/events/:id/participants/:cid`| body `{role}` 改角色 |
| `DELETE` | `/api/events/:id/participants/:cid`| 移除一个参与者 |

**权限**：`extract_auth` 已统一认证；handler 内验证 `event.user_id == auth.user_id` 才允许改。

**主参与者同步**：在 `POST/DELETE` 中，事务内把 `event.contact_id` 同步到"第一个 remaining participant 的 contact_id"，若无则置 NULL。`PATCH` 不动主参与者。

### 3.2 桌面 Tauri 命令

```rust
#[tauri::command]
pub async fn event_add_participant(
    conn: tauri::State<'_, DbConn>,
    event_id: String, contact_id: String, role: String,
) -> Result<(), String>

#[tauri::command]
pub async fn event_remove_participant(
    conn: tauri::State<'_, DbConn>,
    event_id: String, contact_id: String,
) -> Result<(), String>

#[tauri::command]
pub async fn event_set_participant_role(
    conn: tauri::State<'_, DbConn>,
    event_id: String, contact_id: String, role: String,
) -> Result<(), String>

#[tauri::command]
pub async fn event_list_participants(
    conn: tauri::State<'_, DbConn>,
    event_id: String,
) -> Result<Vec<Participant>, String>
```

`event.list()` 与 `event.get()` 返回时 join `EntityLink` 拉 participants，UI 直接显示。

### 3.3 前端 (apps/web-spa)

事件详情卡新增"参与者"字段：
- 显示已选 chip（avatar + name + role 标签）
- "+" 弹出 contact picker（复用现有 ContactPicker）
- chip 上点 `x` 删除
- 长按 chip 改 role

无 schema 重排，无新视图。

---

## 4. 同步集成

### 4.1 新 kind `"entity_link"`

`entity_link` 是无 `updated_at` 的 junction-like 表（实际有 created_at 但同步语义按 push-all 处理）。

**`src-tauri/src/sync/translate.rs` 改动：**

```rust
pub const ENTITY_KINDS: &[&str] = &[
    // level 0
    "contact", "tag", "project", "setting",
    // level 1
    "event", "action",
    // level 2
    "interaction", "reminder",
    // level 3
    "contact_tag", "project_contact",
    // level 3.5 (junction-like, push-all)
    "entity_link",  // NEW
];

pub const JUNCTION_TABLES: &[&str] = &[
    "contact_tag",
    "project_contact",
    "entity_link",  // NEW (synth id, no updated_at)
];

pub fn sqlite_table_to_kind(table: &str) -> Option<&'static str> {
    match table {
        "EntityLink" => Some("entity_link"),  // NEW
        _ => None,
    }
}

pub fn kind_to_sqlite_table(kind: &str) -> Option<&'static str> {
    match kind {
        "entity_link" => Some("EntityLink"),  // NEW
        _ => None,
    }
}

pub fn push_columns(kind: &str) -> &'static [&'static str] {
    match kind {
        "entity_link" => &[
            "id","user_id","from_type","from_id","to_type","to_id",
            "relation_type","role","created_at"
        ],
        _ => &[],
    }
}
```

**`add_junction_id` 已支持 entity_link（因 JUNCTION_TABLES 包含它）** — 无需改动。

### 4.2 server `sync.rs` 改动

- `UPDATED_AT_TABLES` 不加 `entity_link`（保留 junction push-all 语义）
- `push/pull` SQL 动态生成已通过 `push_columns(kind)` 实现，添加 push_columns arm 即可
- 触发器 `entity_link_sync` 已由 migration 创建

### 4.3 冲突处理

- `entity_link` 有 `UNIQUE(user_id, from_type, from_id, to_type, to_id, relation_type)`
- 客户端 push 同 (event, contact, participated) 重复时，主键冲突 → 当 upsert 处理（最新 server_revision 赢）。
- 删除走 soft-delete（deleted_at 标记），与现有 junction 同步语义一致。

### 4.4 event 主参与者同步冲突

`event.contact_id` 在 push 期间被两端分别维护：
- 客户端：本地事务内同步（add participant → 若 contact_id NULL 则置 contact_id；remove last participant → 置 NULL）
- 服务端：handler 内同步（同上）
- LWW：`event.contact_id` 仍按 `updated_at` LWW；本地主参与者写入事件时 `updated_at` 推进，最终一致

边界情况：本地有两个参与者 A、B，server 也改 A、B 的 role。两端最终一致：`event.contact_id = A`（最新 updated_at 事件写入时的主参与者）。

---

## 5. 迁移与回滚

### 5.1 Desktop migration（`src-tauri/src/migration.rs`）

新增一节（追加在现有 rebuild! 之后，与 `ContactTag`/`ProjectContact` 同模式）：

```rust
rebuild!(EntityLink, r#"
    CREATE TABLE IF NOT EXISTS "EntityLink__new" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "from_type" TEXT NOT NULL,
        "from_id" TEXT NOT NULL,
        "to_type" TEXT NOT NULL,
        "to_id" TEXT NOT NULL,
        "relation_type" TEXT NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'participant',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );"#,
    ["id"=>"id", "ownerId"=>"user_id",
     "fromType"=>"from_type", "fromId"=>"from_id",
     "toType"=>"to_type", "toId"=>"to_id",
     "relationType"=>"relation_type", "role"=>"role",
     "createdAt"=>"created_at"]
);
```

**不回填**：现有事件只有 `event.contact_id` 一个联系人，不自动 backfill 进 entity_links（避免侵入既有数据）。本阶段 `entity_links` 表为空，用户创建第一个多参与者事件时开始有数据。

### 5.2 Server migration

新建 `server/migrations/20260807000001_entity_links.sql`：

```sql
CREATE TABLE IF NOT EXISTS entity_links (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    from_type       TEXT NOT NULL CHECK (from_type IN ('contact','event','action','project','interaction')),
    from_id         TEXT NOT NULL,
    to_type         TEXT NOT NULL CHECK (to_type IN ('contact','event','action','project','interaction')),
    to_id           TEXT NOT NULL,
    relation_type   TEXT NOT NULL CHECK (relation_type IN ('participated','involved','regards')),
    role            TEXT NOT NULL DEFAULT 'participant',
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, from_type, from_id, to_type, to_id, relation_type)
);
CREATE INDEX ix_entity_link_event   ON entity_links (from_id) WHERE from_type = 'event';
CREATE INDEX ix_entity_link_contact ON entity_links (to_id)   WHERE to_type = 'contact';
CREATE INDEX ix_entity_link_rev    ON entity_links (user_id, server_revision);

CREATE TRIGGER entity_link_sync
BEFORE INSERT OR UPDATE OR DELETE ON entity_links
FOR EACH ROW EXECUTE FUNCTION emit_sync_change();
```

### 5.3 回滚

- 删表 = `DROP TABLE entity_links`（无 FK 引用，因为 `event.contact_id` 仍保留）
- Desktop：`DROP TABLE "EntityLink"`；无需 reverse migration 因为 SQLite rebuild! 模式新增空表不影响老库

---

## 6. 测试

### 6.1 单元测试（rust）

`server/src/handlers/sync.rs::tests`：
- `test_entity_link_push_creates_row`
- `test_entity_link_pull_round_trips`
- `test_entity_link_unique_constraint_violation_returns_conflict`

`src-tauri/src/sync/mod.rs::tests`：
- `test_push_entity_link_synth_id`
- `test_pull_entity_link_inserts_row`

### 6.2 集成测试

`src-tauri/tests/entity_link_sync.rs`：
- 启动本地 SQLite + mock server endpoint
- `event.add_participant(A, organizer)` + `event.add_participant(B, participant)` → 触发 sync → 服务端看到 2 rows
- 服务端 DELETE 参与者 → 客户端 pull 看到删除

### 6.3 手动 QA（开发机）

1. 创建事件，挂 A、B、C 三个联系人，分别 role: organizer/participant/referred
2. 5 分钟内开第二个桌面客户端，登录同账号
3. 验证：第二客户端的该事件显示同样 3 个 participants
4. 第二客户端移除 C → 第一客户端 5 分钟内同步移除
5. 移除最后一个参与者 → 事件 `contact_id` 变 NULL（提醒自动失效，符合预期）

---

## 7. 触及文件清单

### 新增
- `server/migrations/20260807000001_entity_links.sql`
- `src-tauri/tests/entity_link_sync.rs`

### 修改
- `weavine_lib/src/models.rs` — 新增 `EntityLink` 结构 + 双 derive
- `src-tauri/src/migration.rs` — 新增 EntityLink rebuild!
- `src-tauri/src/sync/translate.rs` — 4 处改动（ENTITY_KINDS, JUNCTION_TABLES, sqlite_table_to_kind, kind_to_sqlite_table, push_columns）
- `src-tauri/src/sync/mod.rs` — 无改动（已支持 junction_table 流程）
- `src-tauri/src/commands/events.rs` — 新增 4 个命令：add/remove/set_role/list_participants
- `apps/web-spa/src/components/EventCard.tsx` — 参与者 chip UI
- `server/src/handlers/events.rs` — 5 个新 handler + event.get/list join participants
- `server/src/handlers/sync.rs` — push/pull 通过 push_columns 函数表已支持

### 预估 LOC
- server: ~150（migration 30 + 5 handlers 80 + event join 40）
- desktop rust: ~80（model 25 + commands 50 + migration 5）
- frontend: ~60（chip 组件 30 + 集成 30）

---

## 8. 风险与决策记录

| 风险 | 缓解 |
|---|---|
| `event.contact_id` 与 `entity_links` 不一致 | 应用层事务内同步；UI 显示以 entity_links 为准 |
| entity_link push-all 量大 | 单用户通常 <100 条；远小于现有 `contact_tag` 量级 |
| UNIQUE 约束破坏现有逻辑 | 不存在现有逻辑使用此约束，新增 |
| `event.contact_id` drop 是否必要 | **不 drop**，保留作为主参与者；避免破坏
 reminder/interaction |
| reminder 多人群发 | **不做**，留 P2 增强项 |

---

## 9. 执行阶段拆分（供 writing-plans 转入）

1. **Schema 阶段**（migration）
   - server migration 新表 + 触发器 + 索引
   - desktop migration rebuild! 新表
2. **共享模型阶段**
   - `weavine_lib::models` 加 `EntityLink`
3. **同步注册阶段**
   - `translate.rs` 4 处改动
   - `mod.rs` 无需改动（已支持）
4. **Handler/命令阶段**
   - server handler 5 个 + event join
   - desktop tauri command 4 个 + 主参与者同步辅助
5. **前端阶段**
   - EventCard chip UI
6. **测试 + 验证**
   - 单元测试 + 集成测试 + 手动 QA
   - cargo check / cargo build / cargo test 全绿
