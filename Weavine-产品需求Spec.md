# Weavine 产品蓝图（Product Blueprint / Spec）

> 版本：**v1.2（产品蓝图合并版）** ｜ 整理日期：2026-08-07
> **最近更新（2026-08-27 · v1.3.6/v1.3.7 落地）**：新增 §11.7「md 文件编辑器 + 显式『导入库』架构定稿」——三桌面版（Windows / Linux / macOS）打开本地 `.md` 仅作纯编辑器（保存只写文件、不写库、不参与云端同步）；仅「导入库」显式桥接进 `Note` 表 + `EntityLink` 体系（可关联联系人/待办/日程、随库同步、记来源路径+时间，`imported_from` 路径不上云——服务端 drop 防泄露）；库笔记可导出 `.md`；三平台安装注册 `.md` 默认打开程序（Windows WiX / macOS `Info.plist` UTI / Linux `.desktop` MimeType）+ `tauri-plugin-single-instance` 处理冷启动 argv。新增需求 #40。
> **最近更新（2026-08-28 · v1.3.10 落地，§11.7 增量）**：**OS 文件关联扩展到 docx / pdf / txt / html / htm / xlsx / pptx** —— §11.7 v1.3.6/v1.3.7 仅注册 `.md`；v1.3.10 新增这 6 类（Windows MSI / macOS UTI / Linux .desktop 三平台同步），前端契约不变（`open-md-from-argv` / `MdEditor` 既有转换流程）。commit `86cb08c` / tag `v1.3.10`。详见 §11.7.12。
> **最近更新（2026-09-26 · v1.6.2 同步专项收口 + §15 归档生命周期）**：(1) **§2.3 更新为 F1–F9 已落地** —— **F7 快照端点** `POST /api/sync/snapshot`（新设备/落后设备不再从 revision 0 重放整条变更日志 → 同时解决"已归档待办被大量拉下来"+ 首同步从分钟级降到秒级）、**F8 change-log 触发器 no-op 守卫**（`to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD)` 的 UPDATE 不记日志 —— 这是"越同步越慢"的真凶：`tag`/`interaction`/`reminder`/junction 两端都无 `updated_at` → 客户端每周期全量重推 → 服务端无条件 upsert → 每周期给日志灌一遍全表）、**F9 junction 冲突键按"对"**（客户端每次现生成 UUID vs 服务端 `ON CONFLICT (id)` → 永不冲突 → 每轮被降级成 conflict 噪音）、push 水位不再被单行钉死 + 定向重试退避、pull 分页 200→1000。(2) **新增 §15 归档数据生命周期：自动清理**（用户要求"已归档太多一直累积"）—— 硬删 `action`/`project`/`event`/`note`/`contact`，`setting.archive_retention_days` 可逐用户覆盖（0=永久保留）；走触发器故 DELETE 同步到各端。**保留期与覆盖范围同日二次拍板修正，见下一条。**(3) 顺带修掉 5 处"写不存在的列"导致**删除功能整体失效**的缺陷（客户端 `Media.deleted_at`、`Interaction.updated_at`、`Reminder.updated_at`×2；服务端 `tag.updated_at`）。(4) 头像上传两个 P1：`/api/media` 挂 20MB body 上限（此前吃 axum 默认 2MB → 手机大图必 413）、`upload_avatar` 改后台异步（原 await 上传 → 服务端不可达时 UI 卡到 30s 超时）。**双端 `cargo check` 通过，客户端 lib 测试 63 passed。代码在 `D:\work\weavine`，尚未提交。**

> **最近更新（2026-09-26 二次拍板 · 归档保留期 30 天 + contact 纳入 + spec 副本合并）**：(1) **§15 保留期由 90 天下调为 30 天**（`ARCHIVE_RETENTION_DAYS`），**`contact` 纳入清理范围**（与其它表同一保留期；互动历史因 `interaction.contact_id` 是 `ON DELETE SET NULL` 而**不受影响**）。(2) 清理补齐**两个时钟**（`archived_at` 到期 **+ 墓碑 `deleted_at` 到期**）与**多态引用孤儿清理**（`note_entity` / `media` —— 二者无外键、PG 无法级联；不清理则反链悬空、头像字节（`media.blob`）永不释放）。(3) **修掉同步热路径上的第 6 处"写不存在的列"**：客户端 `sync/mod.rs::apply_change` 的 DELETE 分支对 `Tag` / `Interaction` / `Reminder`（本地表**均无 `updated_at`**）写 `updated_at` → 拉取到这三类 DELETE 时**中断整个 pull 事务**，一条被删的提醒就能让该设备此后所有变更**静默**同步不进来。现按 `UPDATED_AT_TABLES` 白名单分支 + 回归测试 `pull_delete_on_tables_without_updated_at_does_not_crash`。**这是 contact 纳入清理的前置项** —— 每个到期联系人都 CASCADE 出一批 reminder DELETE。(4) **§11.8「全局搜索架构定稿」（2026-08-24 拍板）整节合并回本文档**（该节原仅存于工作区副本，且与本文档 §11.7「md 编辑器」编号冲突，故顺延为 §11.8）；同步吸收副本独有的 §11.5.1–11.5.3（`install_activation` 字段表 / headers 契约 / 鉴权优先级）与 §11.6.1–11.6.4（分层架构表 / SenseVoice 模型细节 / ModelScope 下载源 / Android 打包风险）。**工作区残留副本自本日起归档、不再维护。**

> **最近更新（2026-09-26 三次拍板 · §16 同步增量化 LWW 补全）**：收掉 push 侧最后一块浪费。`tag` / `interaction` / `reminder` 三张表此前**每 30 分钟无条件全量上传**（`push_all` 对不在 `UPDATED_AT_TABLES` 内的 kind 生成的查询无时间过滤 → 只按 `user_id` 全选），是日常同步上行流量的主体。本次为两端补齐 `updated_at TEXT`、全部 16 处写入点改用统一的 `business::lww_now()`、两端纳入 `UPDATED_AT_TABLES`，push 从此只推真实变更。**效果**：无改动时上行接近 0（原先每轮约 1MB 量级，取决于 `interaction` 行数）；配合 F8 后 pull 下行归零，一个 30 分钟周期从「上下行各一份全量」降到「只有变更」。**两条硬约束**：(1) 客户端必须回填哨兵值 `1970-01-01T00:00:00.000Z` —— 留 NULL 会让存量行永不被选中 → **静默停同步**；服务端则**留 NULL**（NULL = 无版本信息，直接接受客户端值）。(2) **服务端必须先上线** —— 新客户端的 SET 子句会引用该列，表里没有则 Postgres 拒绝整条语句、push 500；反方向无需协调，旧客户端不带该字段仍被接受、可自行节奏升级。**过程中新加的守卫测试抓到一处既有隐患**：`migration.rs` 里「扩展 `Interaction.source` CHECK」的重建字面量跑在加列循环**之后**，会把刚加的列再次重建掉 —— 已修该字面量并在 `run` 末尾加幂等兜底。**客户端 67 passed / 服务端 31 passed（各 5 failed，均为既有环境问题，与基线一致）。代码在 `D:\work\weavine`，尚未提交。详见 §16。**

> **最近更新（2026-09-26 三次拍板续 · §17 同步回声与触发时机）**：补掉两块与数据量无关的浪费。(1) **回声过滤** —— `sync_once` 先 push 后 pull，而 pull 原先不排除发起方自己，于是本设备刚推上去的 N 条被自己原样拉回、逐行走 `apply_change`；F8 的 no-op 守卫只挡「重复推送再产生日志」，**挡不住「首次推送的日志被自己拉回来」**。现 pull 请求带上 `device_id`，服务端加 `AND ($4::text IS NULL OR device_id IS NULL OR device_id <> $4)` —— 两个 `IS NULL` 分支都必需：定时任务（`archive_purge`）产生的 DELETE 没有设备身份，必须送达每台设备，否则客户端下次 push 会把行复活；旧客户端不传该字段则退化为原行为，**两端可任意次序上线**。(2) **写入后 debounce 触发同步** —— 此前只有设置页能手动同步，上行时机完全由本设备 30 分钟的定时器决定，跨设备最坏要 2 × 30 分钟才可见（与传输量无关，纯触发机制）。现 `spawn_periodic` 的 `sleep` 换成可唤醒的 `Condvar` 等待（`std` 原语 —— 等待者是普通线程，`tokio` 的通知器不可达），新增命令 `cloud_request_sync`（**只唤醒、不同步执行**，否则会与后台线程抢 SQLite 文件并重复推送），前端在 `MutationCache.onSuccess` 一处挂钩、debounce 2 秒触发（所有写入都走 mutation，故一处即覆盖全部调用点）。**双端 `cargo check` + 前端 `tsc --noEmit` 通过；客户端 67 passed / 服务端 34 passed（failed 均为既有环境问题，与基线一致）。代码在 `D:\work\weavine`，尚未提交。详见 §17。**

> **产品蓝图（唯一权威）**：本文档是 Weavine 的**唯一产品蓝图**。所有需求设计、状态调整、平台策略、中国特性、技术债均回写此处，不再创建独立 spec 文件。文档结构一旦建立保持稳定，后续只追加章节、不重排结构。
> **维护约定（living spec）**：本文档为活文档。每次需求变动须回写本节并更新上方「最近更新」日期；对应的 weavine 子待办统一挂在项目 `Weavine`（`a119f2d7-4b87-4ce9-ac4b-015ab75ea257`）下，与 spec 编号（#1–#20）一一对应，便于持续跟踪。
> **拍板溯源**：§3.5 子系统设计的所有关键决策（解析引擎选型、节奏模型、范围、Android 验证方式）来源于 2026-08-09 brainstorming 会话，详见各小节顶部加粗的「拍板结论」标注。
> 合并来源：
>
> - 《Weavine 产品优化需求文档》（2026-08-06，产品规划视角，12 项需求 + 优先级）
> - 《Weavine 代码审查报告》（2026-08-06，代码现实视角，架构 + 同步根因 + 偏差）
>   代码路径：**`D:\work\weavine`**（Windows 原生；2026-09-26 从 WSL `/home/yf/workspace/opencode/weavine` 迁出，WSL 旧路径已废弃）
>   **2026-09-26 单源说明（已收口）**：本文档（项目根目录版）为**唯一权威**。工作区残留副本 `C:\Users\admin\WorkBuddy\2026-08-06-09-52-21\Weavine-产品需求Spec.md` 自 2026-08-27 起分叉（保留了 §4/§5/§13 的旧 bug 列表结构、缺 §11.6/§11.7/§14/§15），**已于 2026-09-26 按其独有内容合并回本文档后归档**（合并项：§11.8 全局搜索整节、§11.5.1–11.5.3、§11.6.1–11.6.4、§8 的 #47）。副本的 §4（同步性能优化专项）/ §5（技术债）/ §13（代码巡检 quick wins）**按用户决定不再并入** —— 这三节的标题已被标记为「已删除」，本 spec 只承载需求、架构与拍板，bug 修复纪要归 review 报告与记忆，不进 spec。
>   **2026-08-09 合并说明**：项目根目录 `Weavine-产品需求Spec.md` 与当时的"工作区维护版"已对齐统一。项目根目录版原标「✅ 全部落地」，经代码复核（git HEAD `912c7d4`，含 8/9 下午 `f16fe2a` #4 图谱 / `7491e1d` #3 事件多人 UI / `d0fa495`·`912c7d4` #1 头像 / `d9c6e1e` #5 / `7a9bafa` #12 F6 等提交）确认该判断基本成立；原漏记的 §5.7 同步白名单断链（P0）已标注并于 2026-08-09 修复闭环。

---



## 0. 文档说明

本文档是 Weavine 产品优化的**统一需求规格**，把"规划视角"与"代码现实视角"对齐。关键对齐结论：

| 原需求          | 规划预期         | 代码现实（2026-08-06 审查）                      | 本文档处理                        |
| ------------ | ------------ | ---------------------------------------- | ---------------------------- |
| #3 关系模型（P0）  | 事件/项目/待办全做多人 | **项目多人已实现**；事件仍为单 `contact_id`；联系人间无关系边表 | 标记为"部分已实现"，事件多人 + 图谱边待补      |
| #12 多端同步（P0） | 三端一致         | **功能已实现**，但同步性能严重不达标（自激式全量同步）            | 拆出"同步性能优化专项（F1–F6）"，列为 P0 紧急 |
| #4 关系图谱      | 护城河          | 未实现（README 明确在 roadmap）                  | 保持 P1                        |

**图标约定**：`✅已实现` ｜ `🔶部分实现` ｜ `⬜未实现` ｜ `★地基/强依赖` ｜ `▲护城河` ｜ `○增强` ｜ `△可后放`

---

## 1. 产品背景与定位

**Weavine** 是一个关系驱动的"第二大脑 / 个人 CRM（PRM）"，域名 `financialagent.cc`，面向**个人**的关系网络维护者（涵盖自由职业者、独立代理人等以**个人身份**经营关系网络的用户）；**明确排除企业微信等团队协作 / 企业通道**（详见 §11 中国市场原则）。

设计哲学（README）：offline-first、本地数据所有权、简洁、可审计（AGPL）、可预测的 LWW 冲突解决。

### 1.1 优化目标映射

| 目标             | 对应需求                             |
| -------------- | -------------------------------- |
| **把"关系"做成护城河** | #3 关系模型 + #4 关系图谱（双向多对多 + 正/反查询） |
| **多端可用且快**     | #12 多端同步 + 同步性能专项（F1–F6）         |
| **提升日常可用性**    | #5 查找即新建、#11 名片提取、#1 头像          |
| **变现与合规**      | #6 onboarding/套餐、#9 云选型          |

---

## 2. 架构与现状（来自代码审查）

### 2.1 技术栈（real）

- **桌面端 `src-tauri`**（crate `weavine_lib`）：单用户、本地 SQLite（`weavine.db`），camelCase，rusqlite 直查。产出 `weavine`（桌面）与 `weavine-web`（独立 HTTP 服务）两个二进制。
- **云端 `server`**（crate `weavine-server`）：多用户、Postgres、snake_case、sqlx 0.8。**复用 `weavine_lib::models` 实现"one model two engine"**。
- **前端 `apps/web-spa`**：React 18 + Vite，Tauri WebView 加载，也可作 Web/PWA。
- **`weavine-mcp`**：MCP 服务，供 AI 客户端操作 weavine 数据。

### 2.2 多人关系 —— 实现状态（✅ 全部落地，2026-08-09 复查，git HEAD `912c7d4`）

> 用户原话"项目目前已经是多人了，也做了多端同步"——**复查确认已全面落地**（与项目根目录 `Weavine-产品需求Spec.md` 8/9 15:07「✅ 全部落地」判断一致）。§5.7 同步白名单断链已于 2026-08-09 修复（entity_link/media 入白名单），跨端同步已闭环。

| 维度 | 需求 | 实现状态 | 代码证据 |
|------|------|---------|----------|
| 项目多人 | 项目聚合多人 + 角色 | ✅ 已实现 | `project_contact` 关联表，复合主键 `(project_id, contact_id)` + `role` 字段 |
| 事件多人 | 日程/事件多人 + 角色 | ✅ 已实现 | `entity_links` `participated` 边 + server `event_participants` CRUD + web `ContactMultiPicker` 多选（commit `7491e1d` / `a9b8e6a`） |
| 实体关联图 | 5 类实体（contact/project/event/action/note）一跳关系 | ✅ 已实现（2026-08-25） | server `GET /api/entities/:entity_type/:entity_id/graph`（5 个 expander） + Tauri `entity_graph`（本地 SQLite，同 5 个 expander） + web `GraphView` SVG 视图 + 4 E2E（commit `1a6f720`）。原 ContactGraph（`597a6f8`/`f16fe2a`，`/contacts/:id/graph`，`knows` 边增删）已删除，由 5 中心通用视图取代 |

**结论**：多人关系底座（#3）与关系图谱（#4）均已完成；§5.7 同步白名单断链已修复，跨端同步闭环。

### 2.3 同步 —— F1–F21 已落地（v1.6.2，2026-09-27 五轮收口）

- **F1–F6**（服务端 LWW 用 `>`、客户端增量 push、pull 事务化、服务端单事务、日志 prune、推送分片）已落地。
- **F7 快照端点** `POST /api/sync/snapshot`：新设备 / 落后设备**不再从 revision 0 重放整条变更日志**，改拉每表当前态（keyset 分页 `WHERE id > cursor ORDER BY id`，跳过已归档）。这同时解决了"已归档待办被大量拉下来"。游标取 `current_revision()` = `GREATEST(MAX(sync_change_log.server_revision), sync_meta.pruned_through_revision)`——⚠️ **不可用 `sync_manifest.server_revision`，该列从未被写过，永远是 0**。旧服务端无此端点时客户端自动回退日志重放。
- **F8 change-log 触发器 no-op 守卫**：`to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD)` 的 UPDATE 不再记日志、不消耗 revision。这是"越同步越慢"的真凶——`tag` / `interaction` / `reminder` / 全部 junction 表**两端都没有 `updated_at`**，且客户端对无 `updated_at` 的表生成的 push SQL 没有时间过滤 → **每周期全量重推**，服务端无可比较字段 → 无条件 upsert，此前每周期为每行灌一条 change_log。
- **F9 junction 冲突键**：客户端 junction 行本地无 `id` 列，`add_junction_id` **每次推送现生成 UUID**，而服务端冲突键是 `ON CONFLICT (id)` → 永不冲突 → 每轮撞唯一索引被 `is_data_conflict_error` 降级成 conflict。改为按"对"：`contact_tag → (contact_id, tag_id)`、`project_contact → (project_id, contact_id)`。
- **push 水位**不再被单个永久失败行钉死（否则每轮全量重推）→ 无条件推进 + 本机专用表 `SyncPushRetries` 定向重试（按主键、退避 1m/5m/15m/1h/6h、上限 6 次）。
- **pull 分页** 200 → 1000（服务端上限），串行往返降 5 倍。
- **F10 三张热表补 LWW 列（2026-09-26 三次拍板，收口 F8 剩下的另一半）**：`tag` / `interaction` / `reminder` 此前**每 30 分钟无条件全量上传**（F8 只止住了日志膨胀，push 侧没动），是日常同步上行的主体。现两端补齐 `updated_at`、16 处写入点统一走 `business::lww_now()`、两端纳入 `UPDATED_AT_TABLES` → **无改动时上行接近 0**。两条硬约束：backfill 哨兵值两端语义**刻意相反**（客户端填 `1970-01-01T00:00:00.000Z`、服务端留 NULL），且**服务端必须先上线**（新客户端的 SET 子句会引用该列，缺列则整条语句被 Postgres 拒绝、push 500；反方向无需协调）。旧客户端 payload 缺该字段时按「无 LWW 信息」接受——**不能**用空串做默认值，否则旧客户端的三类写入全部被拒且**静默**停同步。**junction 四表仍不做**：它们缺的是删除传播而非 `updated_at`（见 §16.6）。新守卫测试 `column_lists_agree_with_real_schema` 在此过程中抓到 `migration.rs`「CHECK 重建字面量跑在加列循环**之后** → 把刚加的列又重建掉」的既有隐患。详见 §16。
- **（历史记录）该债当初为何未动**：改增量需两端加列 + 加入 `UPDATED_AT_TABLES` + 所有写入点（含软删）维护该列；⚠️ 只加列表不维护列会让 NULL 永远推不上去（静默丢数据）。F10 正是把这三点做完，并以「`run` 末尾幂等兜底 + 双向守卫测试」兜住该风险。
- **F11 pull 排除来源设备（回声过滤，2026-09-26 三次拍板续）**：`sync_once` 同轮先 push 后 pull，而 pull 不排除发起方自己 → 本设备刚推的 N 条被自己拉回、逐行走 `apply_change`。`sync_change_log.device_id` **一直有值**（服务端各 handler 都 `set_config` 了），只是 pull 没用。现带上并按 `AND ($4::text IS NULL OR device_id IS NULL OR device_id <> $4)` 过滤：`device_id IS NULL` 保住**定时任务产生的变更**（`archive_purge` 无请求上下文 → 它的 DELETE 的 device_id 为 NULL，**必须**送达每台设备，否则客户端下次 push 把行复活）与存量行；`$4::text IS NULL` 让旧客户端的请求退化为全拉，**两端可任意次序上线**。详见 §17.1。
- **F12 写入后 debounce 触发同步（2026-09-26 三次拍板续）**：上行时机此前完全由本设备 30 分钟定时器决定（「上轮拉到过数据」只加快**下行**的追赶），跨设备最坏 2 × 30 分钟才可见 —— 与传输量无关，纯触发机制，也是"量降下来了还是感觉慢"的原因。现 `spawn_periodic` 的 `sleep` 换成可唤醒等待（`std::sync::Condvar`；等待者是普通 `std::thread`，故 `tokio::sync::Notify` 不可达），新增 `sync::request_sync()` + 命令 `cloud_request_sync`（**只唤醒、不同步执行** —— 前端直接跑 `cloud_sync_now` 会与后台线程抢同一个 SQLite 文件并重复推送），前端挂 `MutationCache.onSuccess` + debounce 2 秒（所有写入都走 mutation，一处即覆盖全部调用点；也避免批量操作连发几十次触发）。详见 §17.2。
- **F13–F17 第四轮 review 修复（2026-09-26）**：① **F13** `delete_avatar` / `delete_media` 只写 `deleted_at` 不推进 `updated_at` → 墓碑永远落在 push 水位之下 → **头像/附件删除静默不上行**（`media ∈ UPDATED_AT_TABLES`，过滤条件是 `updated_at > 水位`；把 `deleted_at` 加进 `push_columns` 只让它**有能力**传输，`updated_at` 才让它**有资格**被选中）。② **F14** `wait_for_kick` 未在等待**前**消费标志位，而 `Condvar::wait_timeout` 不检查它 → 「同步进行中到达的唤醒」被吞掉，稳态下（pulled=0）退回 30 分钟等待，F12 的一半价值失效。③ **F15** 全仓无 `busy_timeout`（rusqlite 默认 0），WAL 单写者下第二个写者立即 `SQLITE_BUSY`；F12 让「写入后 2 秒起跑同步」成为常态 → 4 个磁盘连接统一 `CONN_PRAGMAS`（含 `busy_timeout=5000`）。④ **F16** `push_columns("contact")` 漏 `archived_at` → 联系人归档状态**两端各自半死**（服务端清理谓词以该列为键，永无值可达）；守卫测试由"只查 `project`"改为对真实迁移断言**所有**带该列的表。⑤ **F17** `DELETE /api/settings` **不按 key 限定**会清空用户全部设置（`archive_retention_days` 就在这张表里，而它驱动硬删）。另建立**墓碑写入核对清单**（写 `deleted_at` 的表若在 `UPDATED_AT_TABLES` 内必须同时推进 `updated_at`；客户端 11 处已全部合规）。详见 §18。
- **F18–F21 第五轮 review：租户隔离（归属校验）审计（2026-09-27）**：形状统一 —— handler 的**主**语句带 `AND user_id`、命中 0 行时**不报错**地继续执行，于是**次级**写入照常落库，直到最后的响应查询才发现找不到行并返回 404（**写已经提交**）。① **F18** `event::update` / `event::delete` 是同一文件里**仅有的两个**没调 `authorize_event` 的 handler（其余 4 个都调了）→ `UPDATE event SET contact_id`、`UPDATE reminder SET deleted_at`（均无 `user_id`）以及 `upsert_event_reminder` 按 `invitation_token` 查/改（该 token 可猜、不跨用户唯一）都能落到他人行上；reminder 墓碑会经 `sync_change_log` 同步到对方所有设备。② **F19** `tag::update` 尾读无 `user_id` → 写是空操作、响应却返回**对方的标签数据**（200）。③ **F20** `contact_tag.tag_id` 的 FK **不含用户维度**，而插入前不校验 tag 归属、两处读标签的 JOIN 也不带 `user_id` → 可把他人的 tag 挂到自己联系人上并让它**渲染进自己的界面**，且该 junction 行会带着"自己的 user_id + 对方的 tag_id"进入同步流。④ **F21** `log_requests`（**鉴权前**的全局中间件）与 `serve_file`（`/files/*key` 公开路由）把请求行 / key **原样**写日志，无界。修法一律是**让语句自限定**（每条次级语句各自补 `user_id`，`sync_main_participant` 直接加 `user_id` 参数）而不只是补一道门 —— 这一族连续三轮都是"依赖远处的门"引起的。另加**两条源码扫描守卫测试**（写语句必须含 `user_id`；按主键的 `SELECT` 同样，例外须写理由）并带下界断言防假绿。详见 §19。

---

## 3. 需求清单（按优先级，含实现状态）

### 🔴 P0 — 地基（不做，后续全卡住）

#### ★ #3 关系模型重构（✅ 已实现，2026-08-09 复查，git HEAD 912c7d4）

**目标/价值**：将"单外键"升级为"带类型的多对多关系边"，为图谱（#4）提供数据底座。

**语义澄清（已确认）**：

- **待办（actions）** = 个人做事的 todo list，**单人**，不引入"参与者"。
- **日程/事件（events）** = 记录大事件与**多人互动**，必须支持多人 + 角色。
- **项目（projects）** = 多人，按角色。

**建议数据模型（junction 方案）**：

```
entity_links
  id              PK
  tenant_id       FK (隔离)
  from_type       enum: contact|event|action|project|interaction
  from_id         UUID
  to_type         enum: contact|event|action|project|interaction
  to_id           UUID
  relation_type   enum: participated | involved | regards
  role            varchar
  created_at      ts

relation_type × role 枚举:
  participated (事件-人): organizer | participant | referred | mentioned
  involved     (项目-人): owner | collaborator | client | stakeholder
  regards      (待办-人): subject(1个必填) | related(0~N选填)
```

**实现状态与拆分**：

- ✅ 项目侧 `project_contact` 已存在，已对齐到 `entity_links` 的 `involved` 边。
- ✅ **事件侧**：移除 `event.contact_id` 单外键，改为经 `entity_links`（`participated` 边）查询；server `event_participants` CRUD + web `ContactMultiPicker` 多选 + E2E 覆盖。
- ✅ **联系人间关系边**：`entity_links` 中 `contact↔contact` 的边类型（图谱底座）已实现。已扩展为通用 5 中心实体关联图：`GET /api/entities/:entity_type/:entity_id/graph` + `GraphView`（2026-08-25）。
- ✅ 跨端同步已闭环：`entity_links` 已入服务端同步白名单（§5.7 修复，2026-08-09）。

**验收标准**：

- [x] 项目可关联 ≥2 个带角色 Contact（已实现）
- [x] 一个事件可关联 ≥2 个带角色 Contact（已实现）
- [x] 联系人间可建直接关系边（图谱底座，已实现）
- [ ] 待办仅 1 个 subject + 可选 related，无"参与者"（待办仍单人；`regards` 边未落地）
- [x] 正查/反查 API 返回正确（含角色，已实现）

#### ★ #12 多端同步 + 同步性能优化专项（✅ 已实现，F1–F6 已落地；§5.7 白名单断链已修复）

**目标/价值**：三端（Web/PC/移动）数据一致且**同步要快**。无此能力移动端无意义；当前"同步很慢"已严重影响体验，是 P0 紧急止血项。

**功能状态**：offline-first 双引擎 + `manifest/push/pull` 协议 + 5 分钟周期同步**已存在**。
**性能问题**：F1–F6 已全部落地（严格 LWW 杀自激、增量 push、tx-batch pull、chunked push、90 天 TTL prune）。§5.7 白名单断链已修复，`entity_link`/`media` 跨端已通。

**依赖**：无（但 #10 移动端依赖它先有移动端）。
**验收标准**：

- [x] 任一端增改，其他两端在数秒内可见（功能已达成）
- [x] **同步耗时随数据量不线性恶化**（F2 增量 push + F3 tx-batch pull + F6 chunked push，已达成）
- [x] 弱网/离线编辑后联网不丢数据、可合并（严格 LWW 时间戳合并，已达成）
- [x] **`entity_link`/`media` 跨端同步**（§5.7 白名单已补，round-trip 实测通过）

---

### 🟠 P1 — 核心 / 重要（护城河 + 关键可用增强）

#### ▲ #4 关系图谱可视化（✅ 已实现，2026-08-09 复查，git HEAD 912c7d4）

**目标/价值**：Weavine 的**差异化护城河**。把"关系"从文字列表变成可一眼看懂的图。

- 图形化展示实体间一对多 / 多对多关系。
- **正向查询**：某联系人的所有日程、项目、待办。
- **反向查询**：某日程的所有参与人；某项目涉及的所有人。
- 连线按 `relation_type/role` 区分颜色与样式。
- 节点规模：先支持数百~数千节点（力导向布局 d3-force / cytoscape）；仅画直接关系。
- 节点带头像（#1）提升可读性。
  **依赖**：#3（数据底座）、#1（头像）。
  **验收**：打开任一联系人/项目/事件/行动/笔记可见其关联子图；5 类实体可互为中心；数百节点不卡顿。（已实现：`/api/entities/:type/:id/graph` 一跳广度优先 + `GraphView` SVG 视图 + 5 个 detail page 加 🕸️ 按钮 + 4 E2E，commit `1a6f720`。2026-08-25 删除旧的 ContactGraph + `knows` 边增删，因通用视图已覆盖）

#### ○ #5 查找环节允许新建（✅ 已实现，2026-08-09 复查）

**目标/价值**：低风险体验增益，搜索无结果时就地快速新建（quick-create），不跳出流程。

- 所有搜索/查看界面无匹配时提供"快速新建"入口。
- 新建后自动回填当前上下文（如自动关联刚建的边）。
  **依赖**：#3。**验收**：任意查找界面无结果可一键新建并继续原流程；新建实体立即被引用。（已实现：`SearchablePicker` emptyState CTA + E2E 覆盖）

#### ○ #11 名片提取联系人（✅ 已实现，2026-08-09 复查）

**目标/价值**：个人用户的冷启动加速器（频繁见客户的自由职业者、独立经营者同样适用）——拍照/上传名片即建联系人。

- 名片 OCR + 结构化解析（姓名/公司/职务/电话/邮箱）。
- 预填表单，用户确认入库；置信度低时高亮待校正。
- OCR 可端侧或云端，注意隐私。
  **依赖**：无。**验收**：上传名片可提取主要字段；确认后正确入库。（已实现：server leptess OCR handler + 桌面 `extract_card` + web `CardScanner` 集成到新建联系人，中文姓名优先）

#### ○ #1 头像（✅ 已实现，2026-08-09 复查；2026-08-17 v1.0.9 补齐桌面渲染：files:// 协议 + 桌面 avatar_storage_key write-back）

**目标/价值**：提升辨识度，直接支撑 #4 图谱可读性。

- 联系人与用户均可设头像；列表/详情/图谱节点均展示。
- 支持上传 + 首字母/色块兜底；移动端可调用相机。
  **依赖**：无（#4 强烈建议先有）。**验收**：可上传/更换头像；在列表与图谱节点正确显示。（已实现：Media 表 + `/api/media` 上传 + 裁剪 modal + server 持久化 + 图谱节点头像 + 首字母兜底；跨端同步已闭环 §5.7；**v1.0.9 补齐桌面渲染**：`upload_avatar`/`delete_avatar` 显式回写 `Contact.avatar_storage_key`/`avatar_mime`(桌面无 DB trigger,手动镜像)；`get_avatar` 路径修 user_id 双 join bug；Tauri 注册 `files://` 自定义协议 + `TauriAdapter.baseUrl='files://localhost'` 解决桌面 WebView `/files/{key}` 404 问题——**该写法仅对 macOS/Linux 生效；2026-08-18 修正：WebView2/Android WebView 下自定义协议映射为 `http://files.localhost/<path>`，`tauri.ts` 已改 `filesBaseUrl()` 按 UA 区分（Windows/Android→`http://files.localhost`，mac/Linux→`files://localhost`）**）

#### ○ #13 手机端语音快速捕获（🟢 已实施，详见 §3.5）

**目标/价值**：手机端旗舰交互——"说句话即建日程/联系人"，把关系捕获成本降到最低，是 local-first 与 #10 端上小模型哲学的落地点。**无需云端大模型，全链路端上闭环**。

**状态**：2026-08-09 brainstorm 已批准子系统设计（合并 #13/#14/#15 → 快速捕获与节奏中枢），进入实施。**详见 §3.5**。

**简短依赖**：#10（端上小模型，可降级为规则）、#3（事件多人）、§5.7 同步闭环；新增数据列 `contact.last_interaction_at` + `ReminderKind::Cadence` 枚举。

---

### 🟡 P2 — 实用 / 可缓（上线前或之后补）

#### △ #9 云服务器选型（⬜ 未实现）

**目标/价值**：决定能否进入特定市场（国内合规/数据驻留友好）。

- 明确目标市场（国内/海外），对应等保或 GDPR；成本与扩展性权衡。
  **依赖**：无（对外发布前定）。**验收**：选定部署区域与合规框架，满足目标市场准入。

#### △ #6 角色定位 Onboarding + 套餐（⬜ 未实现，当前暂缓）

**目标/价值**：**变现前提**。首次进入引导式 onboarding 识别个人角色（独立经营者/自由职业者/个人顾问等以个人身份经营关系网络的用户），按角色推荐默认设置并引导选套餐。

- 角色分几类、免费/付费边界需单独拍板；onboarding 轻量，不与"简洁"冲突。
  **依赖**：产品定位明确后做。**验收**：新用户有角色引导；可据此推荐并设置套餐。

---

### ⚪ P3 — 不急着做（锦上添花 / 强依赖前置）

| 编号    | 需求             | 说明                          | 依赖  |
| ----- | -------------- | --------------------------- | --- |
| △ #8  | 提醒声音           | 提醒铃声/声音设置与实现（开关、音效选择），已实现：settings 内 default/chime/bell/silent | 无   |
| △ #10 | 移动端接入本地小模型 MCP | 手机版连本地端侧迷你小模型 MCP           | #12 |
| △ #2  | 从合影获得独立头像      | 合照识别裁剪单人头像（**隐私坑**：合照其他人授权） | #1  |

---

## 3.5 快速捕获与节奏中枢子系统（Quick Capture & Cadence Hub）— 合并 #13/#14/#15

> **拍板结论（2026-08-09 brainstorming）**：本地轻量解析优先 + 可选大模型边界最终定为「**纯本地确定，LLM 不上线**」（留给 #18/#20 后续）；节奏模型 = 按重要度档（亲密 14 天 / 重要 45 天，普通不提醒）；范围 = Web + Desktop + Android 全量 + 桌面麦克风；Android 验证方式 = APK + 本地模拟器。

**一句话定位**：让用户在 5 秒内把一个想法 / 待办 / 互动 / 日程，通过键盘或语音，落到对的人身上，系统按关系重要性自动提醒"该联系谁了"。

**范围（已确认）**：

- ✅ Web（5181）+ Desktop（Tauri macOS/Windows/Linux）+ Android（Tauri APK，模拟器验证）
- ✅ Ctrl+K 全局面板（Web/Desktop），Android 用浮动 FAB
- ✅ **语音输入**：Web 走 Web Speech API（国内实测可用：Safari/Chrome 直连）+ 服务端 whisper REST `/voice` 兜底；**Desktop（macOS/Windows/Linux）与 Android 走 sherpa-onnx 端上 ASR**（Rust 核心共享，详见 §11.6 语音识别架构定稿）
- ✅ 一句话创建：**日程 / 待办 / 互动**（三件事）
- ✅ 本地确定性解析（规则 + chrono + 联系人模糊匹配）
- ✅ #14 节奏提醒：**亲密 14 天 / 重要 45 天，普通不提醒**；**owner = 端上 first-party + Server**(为 Web) + invitation token 去重(B2 拍板)

### 3.5.1 拍板结论（2026-08-09 brainstorming）

**核心取舍**：
- **本地轻量解析优先**：规则 + chrono + 联系人模糊匹配——**LLM 不上线**（留给 #18/#20 后续）。
- **节奏模型 = 按重要度档**：亲密 14 天 / 重要 45 天，普通档不提醒。
- **owner = 端上 first-party（B2）**：桌面/Android 各自 SQLite 算本地、Server 算为 Web；同一 trait 抽象两套实现。

**范围**：
- ✅ Web + Desktop（Tauri macOS/Windows/Linux）+ Android（APK，本地模拟器验证）+ 桌面麦克风。
- ✅ Ctrl+K 全局面板（Web/Desktop），Android 用浮动 FAB。
- ✅ 一句话创建：**日程 / 待办 / 互动**（三件事）。
- ✅ 语音输入跨端统一（详见 §11.6）。

### 3.5.2 数据模型

- `Contact` 表新增 `last_interaction_at TEXT NULL`（ISO8601）。
- `Contact.importance` 三档固定：`low` / `medium` / `high`，**默认 `low`（不提醒）**；onboarding 强制提示用户给首批联系人打标签（避免"节奏提醒从未触发"）。
- `ReminderKind` 复用枚举 +1：`Time`（已有）+ `Cadence`（节奏触发）。
- 删除死字段 `reminder_enabled` / `reminder_interval_days`（从未真实使用，被 Cadence 中枢取代）。
- 互动补记时 `last_interaction_at = interaction.occurred_at`（**不是 NOW**），保持节奏语义——补记"上周吃饭"不能刷新到今天。

### 3.5.3 本地解析（确定性，无 LLM）

- **时间**：chrono 中文 + 英文（"tomorrow", "下周三", "下个月15号"）。
- **联系人**：已存联系人的姓名 / 别名 / 拼音简写 / 手机号尾号匹配。
- **关键词**：手维护 kind 分类（"开会/见/约" → Event；；"待办/记得" → Action；；"吃饭/通话" → Interaction）+ 置信度评分。
- **兜底**：永远创建一个 Action，raw 文本作 summary，UI 标"未识别时间 / 未匹配联系人，点击补全"。

### 3.5.4 UI 设计

**Web/Desktop**：Ctrl+K 触发；Tab 切换日程/待办/互动；输入框 + 实时解析预览（"→ 周三 14:00，联系人: 李雷"）；联系人下拉实时匹配；Enter 创建 / Esc 关闭。

**Android**：浮动 FAB；全屏面板（Web/Desktop 同款）；底部麦克风按钮，**长按**录音 → sherpa-onnx 端上 ASR 转文字 → 自动填入。

**v1.0.9 UX 变更**：名片扫描入口从 `ContactDetail`（只读）移到 `ContactEdit`（编辑）——扫描结果是草稿，须用户确认入库。

### 3.5.5 #14 节奏触发

- 阈值固定：高(亲密) = 14 天；中(重要) = 45 天；低(普通) 显式不参与循环。
- 调度：Desktop / Android tokio task 每小时跑一次；Server cron 每小时跑一次（为 Web 端计算）。
- **跨端去重（B2 协议）**：`invitation_token = "{user_id}:{contact_id}:{threshold_day}"` 确定性生成；多端各自算 cadence 时按 token 幂等——靠内容寻址天然去重，无中心化协调表。
- 取消 / 暂停：用户在联系人详情页点 [知道了] → 删除该 cadence reminder + 7 天内不重弹；设"暂停提醒 N 天" → 跳过。

### 3.5.6 多端同步策略

走既有 sync 通道：reminder 表 + `ReminderKind` 区分已可承载 cadence_reminder；`contact.last_interaction_at` 列同步走既有 contact sync 路径。

### 3.5.7 测试策略

- 单元：`quick::parse` 30+ 用例（中/英 时间 + 联系人 + 类型）；`cadence::tick` 边界（亲密/重要过期、普通档跳过、invitation_token 幂等）。
- E2E：Web Playwright `quick-capture.spec.mts` ×3；桌面麦克风手动验证。
- Android：模拟器 APK 端到端（FAB → 文本/语音 → 创建）。

### 3.5.8 不在范围（明确）

- ❌ **LLM 解析**（留 #18 / #20 后续）
- ❌ **iOS**（本次仅 Android）
- ❌ **全局搜索 / 命令面板扩展**（仅创建 + 跳转联系人详情）
- ❌ **全局默认值 UI**（亲密 14 / 重要 45 硬编码，后续如要 UI 改设置再加）
- ❌ **上架 / 应用商店**（仅 APK 本地）

---

## 3.6 事件开始提醒与跨端原生通知（Event Reminder & Cross-Platform Native Notifications）

> **拍板结论（2026-08-15，v1.0.4 修订）**：
> - **D1 = A**：事件 INSERT/UPDATE 时**客户端**即时派生 reminder 写入本地 reminder 表（kind='time'，event_id FK；trigger_at = start_at − reminder_lead_minutes），并在同一调用栈里 schedule_for_reminder。
> - **D2 = A**：多端各弹一次，共享 dismissed 状态——任一端调用 `POST /api/reminders/:id/dismiss` 即把 invitation_token 对应的全部 reminder 标记 dismissed（用 `event:{event_id}:{lead}` 作为 token 内容寻址）。
> - **D3 = A**：保持现状——store UTC（TEXT），前端 toLocaleString 按本地时区显示。reminder_lead_minutes 是整数分钟，无夏令时歧义。
> - **D4 = A**：本轮只做 Web + 桌面（Tauri macOS/Windows/Linux）+ Android APK，iOS 留 #10 远期。
> - **D5 = B**（**v1.0.4 推翻**）：Tauri 端不再轮询 reminder 表；`schedule_for_reminder` 在 Rust 里 spawn 一个 `tokio::sleep(trigger_at - now - 5s)` 任务，到点调 `tauri-plugin-notification` 的系统 API（Android NotificationManager / WinRT / NSUserNotification / libnotify），同时 `claim_due_reminders` 标 `dispatched=true`、发 `weavine:reminder-fired` event 给前端做 in-app banner。Browser standalone（`isTauri() == false`）继续走 30s 轮询 + Web Notification API（Rust runtime 不可用）。
> - **D6 = A**（v1.0.4 新增）：`startup_catch_up()` 在 `lib.rs::setup()` 里跑，list 所有 `dispatched=false AND dismissed=false` 的 reminder，重新 schedule。处理 "Android 在 sleep 期间被 OS 杀掉" 的漏发。
> - **事件 reminder_lead_minutes 默认值**：0 = 不提醒；> 0 时按整数分钟派生。QuickCapture 已接 reminder_lead_minutes 字段（schema 已就绪）。
> - **kind 复用**：`reminder_kind_check` 当前约束 `('time','cadence')`；事件派生用 `kind='time'`，靠 `event_id` FK 与 invitation_token 区分。**不扩枚举**，避免再次迁移。

### 3.6.1 拍板结论（2026-08-15，v1.0.4 修订）

- **D1 派生位置**：事件 INSERT/UPDATE 时**客户端**即时派生 reminder 写入本地（kind=`time`，event_id FK；trigger_at = start_at − reminder_lead_minutes），同一调用栈内 schedule。
- **D2 多端共享 dismissed**：任一端 dismiss 即按 invitation_token 把全部同源 reminder 置 dismissed（用 `event:{event_id}:{lead}` 作为 token 内容寻址）。
- **D3 时区**：store UTC（TEXT），前端 `toLocaleString` 按本地时区显示；`reminder_lead_minutes` 整数分钟无夏令时歧义。
- **D4 范围**：本轮 Web + 桌面（Tauri 三平台）+ Android APK；iOS 留 #10 远期。
- **D5 触发机制**（**v1.0.4 推翻**客户端轮询）：Tauri 端不再 30s 轮询——`schedule_for_reminder` 在 Rust 里 spawn `tokio::sleep(trigger_at - now - 5s)`，到点调 `tauri-plugin-notification` 的系统 API + `claim_due_reminders` 标 dispatched + emit `weavine:reminder-fired` 给前端做 in-app banner。Browser standalone（无 Rust runtime）保留 30s 轮询 + Web Notification API 兜底。
- **D6 启动补发**（v1.0.4 新增）：`startup_catch_up()` 在 `lib.rs::setup()` 里跑，list 所有 pending reminder 重新 schedule——处理 "Android 在 sleep 期间被 OS 杀掉" 的漏发。
- **kind 复用**：事件派生用 `kind='time'`，靠 `event_id` FK + invitation_token 区分；不扩枚举（避免再次迁移）。

### 3.6.2 拍板理由（v1.0.4 为何弃用客户端轮询）

- 30s 轮询每秒耗 CPU + 耗电，且 poller 和 Rust sleep 任务可能双发（race condition → 同一 reminder 弹两次）。
- Rust `tokio::sleep` 在睡眠期是 0 持续开销，OS 调度器只在 trigger_at 唤醒，到点精度 ±5s。
- 用户改 `reminder_lead_minutes` → DELETE 旧 reminder + INSERT 新 → schedule 新任务；旧 sleep 任务到点醒来调 `claim_due_reminders`，**因为行已被 DELETE**，自然不重复发。

### 3.6.3 数据模型（无新表，复用 reminder）

事件派生用 `kind='time'` + `event_id` FK + `invitation_token='event:{event_id}:{lead}'`（内容寻址去重）。`reminder_lead_minutes` 默认 0 = 不提醒；> 0 时按整数分钟派生。

### 3.6.4 事件 reminder 派生规则

`commands::event::create_event` / `update_event` 同调用栈内派生：
- **INSERT** (`reminder_lead_minutes > 0` + `start_at` 存在) → INSERT reminder。
- **UPDATE** `reminder_lead_minutes`/`start_at` 变化 → DELETE 旧 + INSERT 新；lead=0 / NULL 时只 DELETE。
- **DELETE / archived** → DELETE 同 token 的 reminder（cascade 由 FK 接管）。

### 3.6.5 三端原生通道

| 端 | 触发路径 | 系统 API |
|---|---|---|
| **Tauri（Web 包装 / Desktop / Android）** | Rust `schedule_for_reminder` → sleep → `tauri-plugin-notification` | macOS UNUserNotificationCenter / Windows Toast XML / Linux libnotify / Android NotificationManager |
| **Web SPA standalone（无 Rust runtime）** | `use-reminder-poller.ts` `isTauri()=false` 分支 → setInterval(30s) → `Notification` API | W3C Notification API |
| **iOS** | ❌ 不在范围 | — |

### 3.6.6 跨端去重（D2）

`POST /api/reminders/:id/dismiss` → server 按 invitation_token 把全部同 token reminder 置 dismissed=true → 下次 list 自动排除。

### 3.6.7 时区与精度（D3）

- store: `trigger_at = (start_at - lead_minutes).to_rfc3339()`（UTC）
- render: `new Date(trigger_at).toLocaleString('zh-CN', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })`
- 用户跨国/改时区：旧 reminder 显示可能偏移（不主动重算，"一次性事件，不补提醒"）。

### 3.6.8 测试策略

- Unit：事件 INSERT/UPDATE 派生 + DELETE cascade + `claim_due_reminders` 过期标 dispatched。
- E2E：Playwright 注册 → 创建事件 (start_at = now+2min, lead=1) → 轮询 reminder API → assert dispatched=true。
- 桌面/手动：Desktop/Android 创建事件 (start_at = now+90s) → 系统通知 → 点击聚焦窗口。

### 3.6.9 与 §3.5 节奏提醒的关系

| 维度 | §3.5 cadence | §3.6 event |
|---|---|---|
| 触发 | 端上 first-party scheduler 小时级扫 contact 表 | 事件 INSERT/UPDATE hook |
| kind | `cadence` | `time`（受 CHECK 约束） |
| 关联 | contact_id 必填 | event_id 必填（contact_id 可选） |
| 去重 token | `{user_id}:{contact_id}:{thr}` | `event:{event_id}:{lead}` |
| 通道 | Web ReminderPoller + CadencePoller | Web Toast + 三端原生通知 |

**两条路径并行不冲突**：cadence 提醒"该联系张三了"，event 提醒"明天 3 点的会"。

### 3.6.10 不在范围（明确）

- ❌ **iOS**（D4 = A；等 #10 远期，证书成本高）
- ❌ **服务端推送通道**（Web Push / FCM / APNs）——客户端轮询足够 P0 验证；后续若要"app 关闭也能收"再单独排期
- ❌ **批量/全天事件 reminder 合并**（留 #16 通话导入 + #18 AI 教练）
- ❌ **提醒声音个性化**（默认系统提示音）
- ❌ **日历导入/导出**（ICS 双向同步留 #9）
- ❌ **重复事件 reminder**（recurring event 留 Phase 3+，当前 reminder 一次性 trigger）

---

## 4. ~~同步性能优化专项~~（已删除：bug 修复纪要）

---

## 5. ~~技术债与 spec/实现偏差~~（已删除：bug 列表）

---

## 6. 实施路线图（合并两条路线）

```
Phase 0  紧急止血      F1(>= → >)                    ✅ 已完成 (严格 LWW)
  │
Phase 1  地基          #3 事件多人 + 联系人间边 ✅ | #12 同步优化 F2/F3/F4/F5/F6 ✅
  │
Phase 2  护城河+可用    #4 关系图谱 ✅ + #1 头像 ✅ + #5 查找即新建 ✅ + #11 名片提取 ✅
  │
Phase 2.5 快速捕获中枢  §3.5 子系统（#13 语音 + #14 节奏 + #15 互动扩展）✅
Phase 2.6 事件提醒中枢  §3.6 子系统（#8 提醒 + event.reminder_lead_minutes 闭环 + 桌面/Android/Web 原生通知通道）✅
  │
Phase 3  变现+合规      #9 云选型 + #6 onboarding/套餐   ⬜ 待做
  │
Phase 4  增强           #8 提醒声音 ✅ → #10 移动端小模型 ⬜ → #2 合影头像 ⬜
  │
Phase 5  中国特性深化   #16 通话导入 → #17 会议简报 → #18 引荐洞察 → #19 机会看板 → #20 AI教练/起草
```

**关键路径**：`#3 → #4 关系图谱` 已完成；`#12 同步性能 F1–F6` 已落地；跨端同步已闭环。中国特性以 **#14 节奏提醒**为 P1 抓手、**#15/#16 本地捕获**为数据积累底座（替代西方"自动流入"）。

---

## 7. 待进一步拍板的问题

1. **#3 角色枚举**是否够用？是否需补"引荐人"独立边类型？
2. **#4 图谱**节点规模上限（数百 vs 数万）？是否需传递关系？
3. **#6 套餐**角色分几类？免费/付费边界？
4. **#9 云选型**目标市场（国内/海外）？对应合规标准？
5. **#10 移动端形态** = Android Tauri APK + 本地模拟器验证（已在 §3.5 拍板）。**"端上小模型 MCP"的协议与承载仍待 #10 独立子项目确定**。
6. **#2 合影头像**隐私授权机制如何合规？
7. ~~**§5 密码哈希**统一为 bcrypt 还是 argon2？~~ —— 已于 2026-08-09 核实无冲突，bcrypt 双栈一致（argon2 仅用于 API key）。
8. ~~**§5.7 同步白名单修复**~~ —— ✅ 已于 2026-08-09 完成（服务端白名单补 entity_link/media + 客户端表名别名 + round-trip 实测），#3/#1 跨端已解锁。
9. **【2026-08-17 拍板】Re-OCR 入口位置**：从 `ContactDetail`（查看页）移到 `ContactEdit`（编辑页）。理由：OCR 扫描结果是草稿，须填入表单由用户确认入库，查看页是只读不保存表单。`ContactDetail` 顶部 `📷 重新拍名片` 按钮 v1.0.9 移除，`ContactEdit` 基本信息标题旁新增同款按钮。

### 7.1 §3.5 拍板记录（2026-08-09 brainstorming）

| 决策点                | 拍板结论                                       | 拒绝的备选                                                    |
| ------------------ | ------------------------------------------ | --------------------------------------------------------- |
| **解析引擎**           | 纯本地确定（规则 + chrono + 联系人模糊），LLM 不上线      | 纯本地（差体验）/ 云端优先（贵）/ 混合并行（复杂度高）                              |
| **节奏模型**           | 按重要度档：亲密 14 天 / 重要 45 天，普通不提醒              | 全局统一频率（淹没重要）/ 交互频率自动推断（解释性差、误判多）                            |
| **范围**             | Web + Desktop + Android 全量 + 桌面麦克风         | 仅 Web/桌面 / 仅 Android / 暂缓                                  |
| **Android 验证方式**   | APK + 本地模拟器                                 | 真机 / 仅代码不验证 / 需上架                                          |
| **Ctrl+K 范围**      | 创建为主（日程/待办/互动 + 跳转联系人详情）                  | 全局搜索 + 命令面板 + 主题切换                                         |
| **#13 语音输入**       | 优先级与 Web/桌面等同，本次随 Phase 2.5 一起做           | 单独延后 / 只桌面 / 只 Web                                          |

> 详细架构与权衡见 §3.5 各小节；后续如要重评，先在 §3.5 顶部追加「拍板变更日志」并回写本表。

### 7.2 §3.5 实施期发现的高优问题（需在写代码前拍板）

> 以下 3 项均为 LLM spec review 阶段未显式讨论、但实施时会直接踩坑的关键决策。**对应代码不能动手**直到对应行 ✅。**已全部拍板并实施完成（2026-08-10）**。

| 编号  | 问题                                                                 | 拍板结论（2026-08-09）                                                                                                          | 状态 |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---- |
| **B** | **节奏提醒「重复弹」** — 单一 owner 设计                                                  | **B2:端上 first-party**：桌面/Android 各自 SQLite 算(为本地)、Server 算(为 Web)。reminder 通过 invitation token 跨端去重(§3.5.6)。代价:多套实现 + 协调协议,实施量约 B1 的 2-3 倍,换取 offline-first + 数据所有权。 | ✅ 已实施（Task 6+10） |
| **C** | **桌面端 cadence 代码错用 PG `Pool`** — 双栈分界未明示                                       | **跟随 B2**:cadence 计算需两套实现 —— server 走 sqlx::PgPool,桌面/Android 走 rusqlite::Connection。同一 Rust trait 抽象,内部各自执行。                                  | ✅ 已实施（Task 4-6） |
| **D** | **语音输入押宝 Web Speech API 不成立** — Android WebView 不支持 SpeechRecognition | **D3:按端能力选最稳** —— Desktop macOS/Windows + Web 走 Web Speech API(成熟零成本);Android 走 Tauri 原生 plugin(`tauri-plugin-android-speechrecognition` + `android.permission.RECORD_AUDIO` + `SpeechRecognizer.createSpeechRecognizer`)。whisper.cpp 留作 #10 远期选项。**（Android 方案于 v1.0.19 起演进为 sherpa-onnx 端上 ASR，弃用原生 SpeechRecognizer plugin，详见 §11.6）** | ✅ 已实施；2026-08-20 演进为端上 sherpa-onnx（见 §11.6） |

> **实施前置**:以上 3 项已拍板。下一步:writing-plans 阶段把 §3.5.5/§3.5.6/§3.5.4 落地为具体模块路径与接口签名(invitation token 协议、cadence trait 抽象、speech plugin 集成)。

### 7.3 Contact 重要度清理拍板记录（2026-08-09 · Phase 2.4 前置）

> 用户在 §3.5 实施前指出重要度现状不一致 → 触发清理。详见 §3.5.2。

| 决策点 | 拍板结论 | 拒绝的备选 |
| --- | --- | --- |
| **档位定义** | **3 档（low / medium / high）+ 默认 low + 节奏映射（high 14 天 / medium 45 天 / low 不提醒）** | 4 档（含 normal）/ 重要性=手动频率字段 |
| **历史 `normal` 数据** | **数据迁移 `normal → medium`**；medium 保留为合法档位；DB / business / server handler 默认改 `'low'`；删 `ContactsList.tsx:67` 的 `'normal'` 过滤常量 | 保留 normal 兜底默认（与 UI 三档不一致）/ 一次性全量改写为 medium |
| **死字段 reminder_enabled / reminder_interval_days** | **完整删除**（双栈 schema + business + sync + handler + types + 2 处测试断言） | 保留但标 deprecated / 留作 §3.5 cadence 后路 |

> **实施前置**：以上 3 项已拍板。Phase 2.4 实施完成后才进入 Phase 2.5 §3.5 主体开发（约 1.5 人/日）。

---

## 8. 需求编号索引

| 编号  | 名称              | 优先级 | 实现状态（2026-08-09 复查 + 2026-08-09 修复迭代至 git HEAD 4b701e4）  |
| --- | --------------- | --- | ------------------------------------------------------------ |
| #3  | 关系模型重构（事件侧）     | P0  | ✅ 已实现（事件多人 + 联系人间边 + 前端 UI + E2E）；跨端同步已闭环 §5.7            |
| #12 | 多端同步 + 性能优化     | P0  | ✅ F1–F6 已落地；§5.7 白名单断链已修复（entity_link/media 跨端已通）          |
| #4  | 关系图谱可视化         | P1  | ✅ 已实现，2026-08-25 重写为 5 中心通用视图（server `entity_graph` + Tauri `entity_graph` + `GraphView` SVG + 4 E2E；commit `1a6f720`）。原 ContactGraph 已删除 |
| #5  | 查找即新建           | P1  | ✅ 已实现（SearchablePicker emptyState CTA）                         |
| #11 | 名片提取联系人         | P1  | ✅ 已实现（leptess 真集成 + CardScanner + E2E）；**v1.0.9 重新拍名片入口从 `ContactDetail`（查看页）移到 `ContactEdit`（编辑页）**（§7 Q9） |
| #1  | 头像              | P1  | ✅ 已实现（crop + graph 节点 + server 持久化）；跨端同步已闭环 §5.7；**v1.0.9 补齐桌面渲染**：`upload_avatar`/`delete_avatar` 写回 `Contact.avatar_storage_key`、修 `get_avatar` 路径双 join bug、注册 `files://` 协议 + `TauriAdapter.baseUrl='files://localhost'` |
| #9  | 云服务器选型          | P2  | ⬜                                                            |
| #6  | Onboarding + 套餐 | P2  | ⬜（暂缓）                                                        |
| #8  | 提醒声音            | P3  | ✅ 已实现（Settings + poller + WebAudio）                          |
| #10 | 移动端小模型 MCP      | P3  | ⬜                                                            |
| #2  | 合影取头像           | P3  | ⬜                                                            |
| #13 | 手机端语音快速捕获       | P1  | 🟢 已实施（Web 走 Web Speech API + QuickFab，Android 走 sherpa-onnx 端上 ASR，详见 §3.5/§11.6）；**v1.0.9 修复 QuickCapture `submit()` `userId` 未就绪时静默 return → 显式 `setError('本地用户尚未就绪')`**（e2e quick-capture ×3 全绿） |

**中国特性新增需求（2026-08-09，详见 §11；每日摘要已排除）：**

| 编号  | 名称                  | 优先级 | 实现状态 |
| --- | ------------------- | --- | ---- |
| #14 | 保持联系节奏提醒（替代每日摘要）    | P1  | 🟢 已实施（CadenceEngine trait + 桌面/Server 双实现 + invitation_token 去重，详见 §3.5） |
| #15 | 语音快记扩展·记互动（扩展 #13）  | P1  | 🟢 已实施（同 §3.5 子系统，Interaction kind 解析 + QuickCapture 支持） |
| #16 | 通话/通讯录本地导入（Android） | P2  | ⬜    |
| #17 | 会议准备简报              | P2  | ⬜    |
| #18 | 引荐洞察                | P2  | ⬜    |
| #19 | 机会看板                | P3  | ⬜    |
| #20 | AI 教练 + 消息起草        | P3  | ⬜    |
| #47 | 全局搜索入口（复用现有 search command + `/search` 页） | P1  | 🟡 后端 `business/search.rs` + `commands/search.rs`、前端 `Search.tsx` 均已就绪，但 UI 无任何入口（孤儿页）；待按 §11.8 加常驻 🔍 入口（桌面侧栏框 / 移动 BottomNav 按钮 / 可选 `/` 快捷键），**⌘K 仍留 QuickCapture** |

---

## 9. 完成度审计（2026-08-09，二次审查 + 合并项目根目录复查）

> **历史基准（2026-08-09 上午审计）**：git HEAD `912c7d4`，含 8/9 下午一波提交：`f16fe2a` #4 图谱、`7491e1d` #3 事件多人 UI、`d0fa495`/`912c7d4` #1 头像、`d9c6e1e` #5、`7a9bafa` #12 F6。
>
> **当前 HEAD（2026-08-09 晚间）**：`4b701e4`（含 §5.7 同步白名单修复 `9194994` + 头像链路 `83d207e` + SW/HMR 修复 `091e857` + Spec 同步 `4b701e4`）。§5.7 同步白名单断链已随修复闭环；§3.5 子系统设计进入实施。
>
> 首次审查：2026-08-06（彼时 #1/#3事件侧/#4/#5/#8/#11 均标 ⬜）。两次审查间增量见 §9.1。

### 9.1 相对 8/6 的变化（⬜ → ✅/🔶）

| 项                | 8/6 状态   | 8/9 状态 | 证据                                                                               |
| ---------------- | -------- | ------ | -------------------------------------------------------------------------------- |
| **#11 名片 OCR**   | ⬜        | ✅      | `server/src/handlers/ocr.rs`（leptess 真调用）+ `CardScanner` + `ContactNew` 接入 + E2E |
| **#8 提醒声音**      | ⬜        | ✅      | `Settings.tsx` + `use-reminder-poller.ts` + `notifications.ts` WebAudio          |
| **#3 关系模型（事件多人 + 联系人间边）** | ⬜（项目侧已做） | ✅ | `entity_links` 边 + server `event_participants` CRUD + web `ContactMultiPicker` + `GraphView`（5 中心通用关联图）+ E2E（`7491e1d`/`597a6f8`/`f16fe2a`/`a9b8e6a`/`1a6f720`） |
| **#4 关系图谱**      | ⬜        | ✅      | `graph.rs` schema + server `GET /api/entities/:type/:id/graph` + Tauri 本地 `entity_graph` + web `GraphView` SVG 视图 + 4 E2E。ContactGraph + `knows` 增删已删除（2026-08-25） |
| **#1 头像**        | ⬜        | ✅      | `media.rs` 命令 + Media 表 + server `/api/media` + crop modal + graph 节点头像 + server 持久化（`d0fa495`/`beb8bfa`/`912c7d4`） |
| **#5 查找即新建**     | ⬜        | ✅      | `SearchablePicker` emptyState CTA + E2E（`d9c6e1e`）                              |
| **#12 F1**       | 🔴 自激    | ✅ 已修   | `sync.rs` 严格 `>`，`==` 静默 no-op                                          |
| **#12 F2/F3/F4/F5/F6** | 🔴       | ✅ 已修   | 增量 push / 客户端 pull 事务 / 服务端单事务+savepoint / change_log 90天 prune / chunked push（`7a9bafa`） |

### 9.2 仍未完成 / 阻塞项

- ~~**🔴 P0 同步白名单断链（§5.7，最高性价比修复）**~~ **✅ 已修复（2026-08-09）**：`entity_link`/`media` 原未入 `server/src/handlers/sync.rs` kind 白名单（L147-166），push 时服务端落 `unknown entity kind` 拒绝 → #3 参与者（entity_link）与 #1 头像（media）的跨端同步不通。已按「2 行服务端白名单 + 1 行客户端表名别名（entity_link↔entity_links）+ round-trip 测试」方案修复并实测通过（push entity_link/media accepted，pull 复数 kind 闭环；`cargo test -p weavine --lib` 27 passed）。
- **🟢 Contact 重要度清理（Phase 2.4 前置）已完成**：详见 §3.5.2 + §7.3。双栈 schema + business + server handler + UI 三档 + 删 reminder 死字段 + 测试改写全部落地。
- **🟢 #13 / #14 / #15 子系统设计已实施完成（2026-08-10）**：详见 §3.5。6 个 commit（ef1b6bc→4d7a66c→5de12f3→0ebd54f→fc013a7），3 个 Playwright E2E 测试通过。前置：Phase 2.4 重要度清理已完成。
- **🟡 #8 提醒声音已部分完成 + Phase 2.6 事件提醒中枢设计已批准（2026-08-11），进入实施**：详见 §3.6。前置：§3.5 已落地，reminder 表 + event.reminder_lead_minutes 字段已存在但缺自动派生 + 跨端原生通道。
- **⚪ #2 / #6 / #9 / #10 / #16–#20** 仍 ⬜；密码哈希双轨技术债 §5-1 已核实无冲突。

### 9.3 估计完成度

- 核心功能（#1/#3/#4/#5/#8/#11/#12）：**本地全功能已落地，跨端同步已闭环**（§5.7 修复）。
- 不加权（按 12 项原生需求 + #13/#14/#15 子系统进度计）：约 **70% → 72%**（Phase 2.4 重要度清理设计中，未计入 ✅ 完成度）。
- 加权（P0×4/P1×3/P2×2/P3×1）：约 **78% → 80%**。
- 关键路径阻塞：§5.7 已修复（#3/#1 跨端已解锁）；Phase 2.4 重要度清理已完成；Phase 2.5 §3.5 子系统已全部实施完成（2026-08-10）；**Phase 2.6 §3.6 事件提醒中枢设计已批准（2026-08-11），进入实施**；下一步排 #16–#20 与 #2/#6/#9/#10。

---

## 10. 产品形态与平台策略（2026-08-09 规划）

> 现状（用户确认）：Web 版已调 server；桌面版与手机版目前**写本地 SQLite、未调 server**。Web 的优势是可承载 AI 能力。

### 10.1 核心判断：不是"web vs 端"二选一，而是"本地捕获 + 云端智能"的混合形态

| 平台         | 定位           | 是否主投入            | 理由                                             |
| ---------- | ------------ | ---------------- | ---------------------------------------------- |
| **桌面版**    | 主捕获面         | ★ 主战场            | 办公场景主入口；原生体验、通知、OS 集成；离线优先                     |
| **手机版**    | 主捕获面         | ★ 主战场            | 见客户/会议现场主入口；相机/通讯录/推送；离线优先                     |
| **Web 版**  | AI 中枢 + 兜底入口 | ○ 重点投 AI，不做日常主入口 | 集中承载重 AI（LLM/图谱/召回）；onboarding、设置、无 app 时的跨端访问 |
| **Server** | 同步引擎 + AI 大脑 | ★ 必投             | 端上数据只有通过它才能同步与智能化                              |

**结论**：继续重投桌面/手机作为产品主形态；Web 定位为"AI 指令中心 + 设置/onboarding + 无 app 兜底"，而非日常主入口；Server 是承上启下的"脑"。

### 10.2 为什么端应为主、Web 为辅

- **关系数据是私密的** → 本地优先（offline-first）建立信任，这是与通用 web CRM 的差异化。
- **捕获发生在真实场景**（开会用手机、办公用电脑）→ 原生 App 在通知、通讯录、相机、后台同步上胜出。
- **离线可用、零延迟** → 飞机/地下室也能记。
- **Web 的拥挤风险**：纯 web CRM 赛道竞争激烈、隐私故事弱、捕获体验差，推 web 为主会削弱护城河。

### 10.3 为什么 Web 仍关键（AI 能力的唯一现实载体）

重 AI（大语言模型、关系图谱分析、embedding 召回、自动起草）**必须 server 侧**——端上 SQLite 只是存储，没有算力与模型。Web 是这些能力最自然的呈现层：

- 关系图谱可视化（#4）、AI 召回/摘要/起草、onboarding 角色识别（#6）、跨端访问兜底。

### 10.4 关键阻塞：端"未调 server" = 数据困在端 = 既无同步也无 AI

当前桌面/手机只写本地 SQLite 不调 server，导致：

1. **无多端同步**（数据困在单设备，设备丢失即丢失）—— 直接否定"多端一致"承诺。
2. **AI 无从触达数据** —— server 拿不到数据，Web 的 AI 能力形同虚设。

**这是比任何单功能都优先的闭环问题**：必须先让端默认、静默、增量地同步到 server，AI 与多端价值才能成立。修复见 §5.7 回归（entity_link/media 白名单）+ §4 F2 增量 push 收口。

### 10.5 AI 能力分层（呼应"手机接本地小模型 MCP"）

- **端上小模型（即时 / 隐私 / 离线）**：会议纪要摘要、跟进建议、快速录入辅助。手机本地迷你小模型 MCP（#10）即此层。
- **云端重模型（深度 / 跨数据）**：关系图谱洞察、跨联系人召回、长文起草、自动化编排。
- 二者互补：端上做"快"，云端做"深"。

### 10.6 投入决策（衔接 §6 路线图）

1. **先补端→server 同步闭环**（§5.7 + F2）：解锁多端与 AI 的前提。
2. **端持续作为主产品形态**：#3 事件多人前端 UI、#1 列表头像、#5 内联新建均应在端上完成。
3. **Web 重点投 AI 呈现**：#4 图谱、AI 召回/起草优先在 Web 落地，结果经同步回灌各端。
4. **不削减端、不迁移到纯 Web**：保持 local-first 定位。

### 10.7 手机端语音快速捕获（#13）= 主形态的旗舰交互

手机端优先的真正抓手是"说句话即建"——把语音捕获做成本地闭环、不依赖云端大模型（端上 ASR + 轻量解析，呼应 #10 端上小模型）。它生产的是 #3 事件多人的数据（"和KK林开会"=事件+参与者），并经 §5.7 同步闭环回灌 server，使 Web 重模型得以在图谱/起草中复用。优先级 P1（用户确认重要）：是手机端最具差异化的捕获方式，但依赖同步闭环先通。

**2026-08-09 更新**：#13 已与 #14 节奏提醒 + #15 语音记互动合并为 **§3.5 快速捕获与节奏中枢子系统**，范围扩展为 Web + Desktop + Android 全量，进入 Phase 2.5 实施（详见 §3.5）。

---

## 11. 中国市场设计原则与特性化需求（2026-08-09 补充）

> 背景：用户明确 weavine 定位为**个人使用**，且**排除企业微信**（属企业 / 销售代理通道）。结合 2026-08 实测——**个人微信是黑盒**（无 API、本地加密、逆向 / 协议模拟违规封号），国内个人场景**不存在任何合规的自动数据通道**。本节把这一硬约束上升为产品原则，据以筛选 / 新增需求，**排除"每日摘要"等不适配国内的西方 SaaS 模式**。

### 11.1 中国市场四大设计原则

1. **数据只能靠主动本地捕获（唯一主通道）**：西方竞品靠"邮箱 / 日历 / 社交 API 自动流入"，国内个人场景对应物（个人微信）完全不可达。规划锁定为——把"手动做到极致顺滑"替代"自动流入"。核心捕获面：语音 #13/#15、名片 #11/#2、通话 / 通讯录本地导入 #16、手动录入。
2. **绝不触碰微信逆向 / 协议模拟（合规红线）**：任何"挂 bot 自动读微信"都属协议模拟，违规且封号。**永久排除**。
3. **主动提醒替代每日推送**：国内个人用户反感每日 digest 轰炸。**不采用"每日摘要"**，改为"按联系人联系周期、逾期才提醒"的节奏提醒（#14）——不打扰但不断联。
4. **核心叙事升级**：「微信不给你看的关系网，weavine 帮你看见。」把 #4 图谱从"好看的可视化"升级为"微信看不到的关系情报"（引荐机会、谁快断了）。

### 11.2 已排除需求（国内不适用）

| 候选                     | 来源      | 排除理由                                                                               |
| ---------------------- | ------- | ---------------------------------------------------------------------------------- |
| **每日摘要（Daily Digest）** | 竞品分析 A2 | 西方 daily digest 推送模式；国内个人场景用户反感每日打扰，且本地优先产品无需每日推送。**已由 #14 保持联系节奏提醒替代**（逾期提醒、不打扰）。 |

### 11.3 中国特性驱动的新增需求（#14–#20）

#### ○ #14 保持联系节奏提醒（Keep-in-Touch Cadence）（🟢 已实施，详见 §3.5）

**目标/价值**：个人关系靠维护，断联=丢机会（转介绍 / 合作 / 人情）。这是国内个人 PRM 的"灵魂功能"，也是"每日摘要"的更优替代。

**拍板（2026-08-09）**：亲密 14 天 / 重要 45 天，普通不提醒（不打扰但不断联）。不引入 `cadence_days` 字段（用 `importance` 派生），不引入全局默认 UI（硬编码）。详见 §3.5 §3.5.5。

**中国特性理由**：零云端依赖、零合规风险；本地可算。

#### ○ #15 语音快记扩展——说句话记互动（扩展 #13）（🟢 已实施，详见 §3.5）

**目标/价值**：国内无合规自动通道（§11.1），数据只能靠主动本地捕获。本需求把语音管线从 #13（建日程）扩展到"说句话记一段互动 / 笔记 / 人情"，把捕获成本压到最低。

**拍板（2026-08-09）**：与 #13 同子系统（§3.5），语音管线复用同一解析引擎（`weavine_lib::quick`），仅 `classify_kind` 加 "吃饭 / 通话 / 聊 / call / dinner" 等互动关键词，落 `Interaction` 而非 `Event`。

**中国特性理由**：以"极致顺滑的手动"替代"自动流入"（§11.1-1）。

#### △ #16 通话记录 / 通讯录本地导入（Android Local Import）（⬜ 未实现，2026-08-09 新增）

**目标/价值**：个人微信黑盒无法自动积累（§11.1），但 Android 通话记录 / 通讯录**本地可读、零合规风险**，是强关系信号——自动建 / 更新联系人并写 interaction（"X 月 X 日通话 12 分钟"），补偿数据缺口。

- Android 本地读取通话记录 / 通讯录，批量建联系人底池 + 写 interaction；iOS 仅做通讯录导入（需授权）。
  **依赖**：Android 本地权限、本地 SQLite 写入、§5.7 同步闭环。**验收**：授权后自动补全联系人并生成互动记录；同步其他端可见。
  **中国特性理由**：Covve 通话集成的中国可行版，纯本地、不碰微信。

#### △ #17 会议准备简报（Meeting Brief）（⬜ 未实现，2026-08-09 新增）

**目标/价值**：见人前 10 分钟"补脑"——汇总参会者档案、上次互动、相关项目、待跟进。国内高频职场 / 人情场景。

- 依赖 #3 事件多人 + interaction 历史 + server 重模型（端上只做聚合展示）。
  **依赖**：#3 事件多人前端、#4 图谱 / Web AI。**验收**：会前自动生成一页简报。
  **中国特性理由**：开会 / 饭局是关系维护主战场；简报需云端重模型，是 Web AI 中枢（§10.3）高频落地点。

#### △ #18 引荐洞察（Intro Suggestions）（⬜ 未实现，2026-08-09 新增）

**目标/价值**：图谱上发现"A 和 B 都认识 C → 可引荐"，自动建议引荐。关系图谱杀手级应用，放大转介绍网络——国内个人 / 生意关系高度依赖转介绍。
**依赖**：#4 图谱 + #3 contact↔contact 边。

#### △ #19 机会看板（Opportunity / Pipeline Board）（⬜ 未实现，2026-08-09 新增）

**目标/价值**：把联系人 / 事件关联成"机会"（转介绍、合作），看板式追踪。从"记人"升级到"追踪结果"。
**依赖**：事件 / 项目模型、状态机。

#### ⚪ #20 AI 关系教练 + 消息起草（B1/B2）（⬜ 未实现，2026-08-09 新增）

- **B1 关系教练**：基于网络给建议（"KK林 3 个月没联系，该跟进"），呼应 #10 端上小模型。
- **B2 消息起草**：基于关系上下文起草中文跟进 / 感谢 / 节日消息；**合规边界：标注"草稿，需人工审核后发送"，不代发**，避免误发 / 骚扰。
  **依赖**：server 重模型 / #10 端上小模型。

> **#4 升级（中国叙事）**：在 #4 图谱验收中并入"A7 微信关系网可视化"叙事——强调"从你主动记录画出微信不展示的关系网 / 引荐机会"，核心句「微信不给你看的关系网，weavine 帮你看见」。

### 11.4 更新后的优先级归属

| 编号  | 名称           | 优先级 | 中国特性理由                   |
| --- | ------------ | --- | ------------------------ |
| #14 | 保持联系节奏提醒     | P1  | 替代每日摘要；本地可算、零合规风险        |
| #15 | 语音快记扩展(记互动)  | P1  | 以极致手动替代自动流入              |
| #16 | 通话/通讯录本地导入   | P2  | 纯本地、补微信黑盒数据缺口            |
| #17 | 会议准备简报       | P2  | 需 server 重模型；Web AI 高频落地 |
| #18 | 引荐洞察         | P2  | 依赖 #4 图谱                 |
| #19 | 机会看板         | P3  | pipeline 追踪              |
| #20 | AI 教练 + 消息起草 | P3  | 需 server 重模型；合规边界明确      |

---

## 11.5 激活跟踪 + per-install device_key（v1.0.3 落地，2026-08-15）

**需求**：把"多少人用了 Weavine"从"只看付费 / 登录用户"扩到"全漏斗：安装→首次使用→30 天留存→登录→付费"——匿名安装也应该被统计进来，否则 P0/P1 优化只盯付费用户会严重误导决策。

**拍板**：

- 每个客户端在首次启动时（5 s 延迟）向 `POST /api/activation/ping` 注册一个客户端自生成的 UUID v4（`install_id`），持久化在 Tauri 数据目录 / `localStorage`。
- server 端在每次 OCR / 语音调用时同步 `call_count` + `last_event`。
- 匿名用户通过 server-minted `device_key`（替代共享 `WV_SERVICE_KEY`）调用 OCR / voice，不需要登录。
- 鉴权链：`X-Device-Key` → JWT/API key → `X-Service-Key`（仅 dev / CI）。
- **quota**（v1.0.9 部分启用）：FREE 100 次/天，TRIAL 50 次/天，PRO 不限；仅匿名 `device_key` 路径走 quota，登录用户 / `SERVICE_KEY` 不限。

**隐私红线**（README "Activation tracking" 节一致）：

- 原始 IP 永不落库，只存 `SHA-256(JWT_SECRET || ip)`。
- `install_id` 是客户端 UUID v4，零指纹——不基于 machine-id / browser fingerprint / 屏幕分辨率 / IMEI / IDFA。
- 客户端只向用户配置的 server URL 打点，不向任何第三方。
- 用户可随时关：删 `install_id` + `device_key` 文件，下次启动 =新 install。

**不在范围**：

- ❌ 用户行为分析（点击流 / 浏览路径）——不是产品定位，留给外部 BI 工具。
- ❌ 推送通知到达率统计——后续若接 server 推送再排。
- ❌ 多 server 端聚合——单租户定位无需。
- ❌ 删除 `install_activation` 行（用户卸载 App）——只是 `last_seen_at` 不再更新，30 天后可清理。

### 11.5.1 数据模型（`install_activation` 表，migration `20260814000001` + `20260820000001`）

| 字段 | 类型 | 用途 |
|---|---|---|
| `install_id` | TEXT PK | 客户端生成 UUID v4 |
| `first_seen_at` / `last_seen_at` | TEXT | ISO8601 UTC |
| `app_version` | TEXT | `"1.0.4"` |
| `os` | TEXT | `"darwin"` / `"windows"` / `"linux"` / `"android"` |
| `platform` | TEXT CHECK (`desktop\|android\|web`) | 运行时类型 |
| `last_ip_hash` | TEXT | `SHA-256(JWT_SECRET \|\| ip)`，**原始 IP 不存** |
| `call_count` / `last_event` | INTEGER / TEXT | OCR / voice 调用计数 + 最近一次事件类型 |
| `device_key` | TEXT UNIQUE partial idx | server-minted 32-char hex，替代共享 `WV_SERVICE_KEY` |
| `plan` / `daily_ocr_count` / `daily_voice_count` / `daily_reset_at` / `revoked_at` | 预留给 quota 体系 | **v1.0.9 部分启用**：FREE 100/天，TRIAL 50/天，PRO 不限；仅匿名 `device_key` 路径走 quota，登录用户 / `SERVICE_KEY` 不限。常量见 `server/src/handlers/activation.rs` |

### 11.5.2 客户端 → server headers（每次 cloud 调用）

```
X-Device-Key:      <32-char hex>          // server 验证 install_activation.device_key
X-Install-Id:      <UUID v4>              // record_activation_hook 用
X-Client-Platform: desktop|android|web    // 进程检测
X-Client-OS:       <os name string>
X-App-Version:     <weavine version>
```

### 11.5.3 鉴权优先级（取代 v1.0.2 的 `extract_auth`）

```
extract_endpoint_auth() -> EndpointAuth
  = AnonymousDevice { install_id }  // X-Device-Key 命中 install_activation.device_key
  | User { user_id, device_id }     // JWT 或 API key 有效
  | ServiceKey                      // X-Service-Key == WV_SERVICE_KEY (dev / CI only)
```

顺序：`X-Device-Key` → `Authorization: Bearer …` / `X-Api-Key` → `X-Service-Key`。

匿名用户调 OCR / voice 不需要登录，server 通过 `device_key` 知道是哪个 install。`register()` / `login()` 后同一 `install_id` 变成 `devices.id`，所以 `JOIN install_activation ON install_id = devices.id` 直接得到"一个用户 N 个设备"的漏斗。

**拍板溯源（2026-08-14 brainstorming）**：

- **Q1 怎么识别"同一用户多端"？** → `install_id` 同时作为 `devices.id` PK，登录时合并。
- **Q2 OCR / voice 是否走同一套？** → 是，server 端 `record_activation_hook` 同源。
- **Q3 是否仍需 `WV_SERVICE_KEY`？** → 仅作 dev / CI / 单元测试 fallback，prod 客户端走 `device_key`。
- **Q4 quota 怎么落？** → `install_activation.daily_ocr_count` / `daily_voice_count` + `daily_reset_at`；**v1.0.9 部分启用**（同 §11.5.1）。

---

*文档合并溯源：本节内容原为「工作区维护版」独有，2026-08-09 与项目根目录版对齐时并入。**2026-09-26 起项目根目录版为唯一权威**，工作区滞留副本已按其独有内容合并回本文档后归档（详见文档头部「合并来源」）。*

---

## 11.6 语音识别架构（v1.0.19 落地，2026-08-20 拍板，国内为主市场）

**需求**：跨端（Web / Desktop / Android）统一提供语音输入能力；国行 Android 无 Google 服务（无原生 SpeechRecognizer、墙内 Web Speech 不可用），需端上 ASR 兜底。

**拍板**：

- **Web**：主路径 Web Speech API（Safari/Chrome 实测可用），兜底服务端 whisper。
- **Desktop（Win/Mac/Linux）+ Android**：sherpa-onnx 端上 ASR（同一套 Rust 核心编译多端），离线、零服务端成本、无 Google 依赖。
- **统一兜底**：服务端 whisper REST `/voice`——长录音 / 噪声 / 低端机 / 模型未下载时降级。
- **明确不采用**：原生 Android `SpeechRecognizer`（国行 GMS 不可用）、纯 Web Speech 作全端主路径（墙 + 非离线 + Google 隐私依赖）。

**模型拍板**：SenseVoice int8（中英日韩粤，达摩院，~239MB）作主档，whisper tiny（~75MB）作低端机兜底。首次使用按需下载，不打进 APK；下载源用国内 ModelScope 魔搭社区避免 GitHub releases 被墙。

### 11.6.1 分层架构（按端能力选最稳）

| 端 | 主路径 | 兜底 | 理由 |
| --- | --- | --- | --- |
| **Web** | Web Speech API（国内实测可用：Safari 走 Apple 后端 / Chrome 代理直连 Google） | 服务端 whisper REST `/voice` | 零成本、准；墙内 / 不支持浏览器回退服务端（修 #46） |
| **Desktop（Win/Mac/Linux）** | sherpa-onnx 端上（Rust command，离线、零服务端成本、无 Google 依赖） | 服务端 whisper | Tauri 原生壳能跑端上；比 Web Speech 更贴 offline-first |
| **Android** | 同一套 Rust 核心（编译 android target）端上 sherpa-onnx | 服务端 whisper | 国行无 GMS，无法用 Web Speech / 原生 `SpeechRecognizer` |
| **统一** | — | 服务端 whisper **始终保留** | 长录音 / 噪声 / 低端机 / 模型未下载时降级 |

> 演进溯源：D3（2026-08-09）原定 Android 走 `tauri-plugin-android-speechrecognition` 原生 plugin；v1.0.19 起实施演进为 **sherpa-onnx 端上 ASR**（国行无 GMS、原生 `SpeechRecognizer` 不可用）。本表为当前权威结论。

### 11.6.2 ASR 模型拍板：SenseVoice int8 主档 + whisper tiny 兜底

- **主档模型**：`sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`（阿里达摩院，非自回归 CTC，中英日韩粤自动检测）。
  - 中文准确率、标点、ITN 数字归一化（「一百二」→「120」）显著优于 Whisper tiny；推理更快；附赠情感 / 音频事件标签。
  - 启用 `use_itn=true` 提升落库文本质量。
- **低端机兜底**：≤ 3 GB RAM 设备跑 239 MB 模型有压力 → 保留 whisper tiny（75 MB）作低档 fallback。
- **体积 / 内存代价**：SenseVoice int8 ~239 MB、运行内存 ~400 MB；首次使用**按需下载**，不打进 APK。
- **许可证**：FunASR Model License v1.1（免费可用，商用需保留署名 / 声明）。

### 11.6.3 模型下载源（国内）

- **国内源 = 魔搭社区 ModelScope（modelscope.cn）**，避免 GitHub releases 被墙。
- 推荐仓库（sherpa-onnx 转换版，weavine 用此）：`Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`（含 `model.int8.onnx` 239 MB + `tokens.txt`）。
- 下载方式（任选）：
  - 单文件直链：`https://modelscope.cn/models/Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/master/model.int8.onnx` + 同目录 `tokens.txt`
  - `git clone https://www.modelscope.cn/Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.git`
  - ModelScope SDK：`snapshot_download('Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')`
- **约束**：sherpa-onnx 要求 `model.int8.onnx` 与 `tokens.txt` **同目录**；下载逻辑写进 `voice_local.rs` 模型配置，落 App 私有目录。

### 11.6.4 已知风险

- **Android `gen/` 目录在 gitignore 内** → `MainActivity.kt` 等**手写**的 Android 源文件没有版本保护，历史上已因误删导致过一次"build 成功但打开即闪退"（manifest 引用 `.MainActivity` 但源码缺失 → `ClassNotFoundException`）。建议在仓库留副本 + 构建脚本拷贝，或 `git add -f`。
- 同一坑的第二种表现：sherpa 的 3 个 `.so`（`libsherpa-onnx-c-api.so` / `libonnxruntime.so` / `libc++_shared.so`）若因 `build.rs` 拷贝目录错位没打进 APK，`Rust.kt` 启动时 `loadLibrary` 失败 → 同样闪退。改动 Android 打包链路时须一并复验这两点。

**不在范围**：

- ❌ iOS（等 #10 远期，证书成本高）。
- ❌ 服务端推送通道（Web Push / FCM / APNs）——客户端轮询足够 P0 验证。

## 11.7 md 文件编辑器 + 显式「导入库」架构定稿（2026-08-26 拍板）

> 背景：用户提出让 weavine 也能打开/编辑本地 `.md` 文件，以扩大使用范围、提高打开频次与粘性。经三轮讨论收敛为如下 v3 模型（2026-08-26）。

**一句话定位**：**Windows / Linux / macOS 三桌面版**同时是本地 `.md` 编辑器；打开/编辑任意 `.md` **只读写文件、不写库、不参与云端同步**。只有当用户显式点「导入库」时，才把当前文件内容作为一条笔记复制进 weavine 笔记库（可关联、可同步）。Web 与移动端不在本期。

### 11.7.1 三态模型（关键，彻底规避双副本分歧）
- **编辑器态（打开外部 `.md`）**：纯文件编辑。保存（Ctrl+S）= 仅写回原文件。不创建/更新任何库记录，不触发 sync。
- **库笔记态（导入后）**：成为 `Note` 表 + `EntityLink` 体系内的一等公民笔记，可关联联系人/项目/待办/日程/互动，随库同步。
- **导入是显式桥接（一次性快照语义）**：「导入库」把**当前文件内容**复制进库，并记 `imported_from`（原路径）+ `imported_at`（时间）作为来源留痕。导入后文件再被外部改动**不影响**库副本（库是 canonical，文件是 source 快照）。

> 为什么不做"保存时同时写文件和库"：那会让"文件"和"库"成为同一笔记的两个副本，各自可独立改动 → 双副本分歧（mtime 对账 / 静默覆盖）。v3 用"编辑器态完全不碰库"彻底规避，且无跨设备文件冲突（文件本就不入同步）。

### 11.7.2 重导入语义（Re-import）
对同一路径再次「导入库」（已存在 `imported_from` 命中）时：
- **快速路径**：若文件 mtime ≤ 该 note 的 `imported_at`（文件没被外部改动过），自动跳过、toast 提示「该文件已是最新，无需重导」；
- **冲突路径**：若文件 mtime > `imported_at`（外部改过了），**弹选择框**：
  - **更新已有笔记**：覆盖该 note 的 `body`（不动 `title` 与 `EntityLink`，避免破坏已有关系网），`imported_at` 刷新；
  - **跳过**：什么都不做；
  - **作为新笔记导入**：保留原 note 不动，新建一条 note 携带相同 `imported_from` 路径。

> 不做静默覆盖——重导入是少数必须打扰用户的时刻，避免用户工作被静默丢失。
> 此语义让 §11.7.7 的「导出 `.md`」自然闭环：导出时**显式用 `setFileTimes` 将文件 mtime 设为 `note.imported_at`**，使其再次被 weavine 重导时 mtime ≤ imported_at → 走快速路径（「已是最新」），无摩擦。若平台/FS 不支持改 mtime，则回退为正常弹选择框，不影响正确性。

### 11.7.3 隐私、信任与编码
- 打开任意 `.md` ≠ 把文件交给 weavine；未点「导入库」前，文件内容不出本机、不上云。契合 §11.1「数据主权」叙事，避免"打开即同步"的惊吓感。
- **编码策略**（国内用户为重要使用场景）：读时自动嗅探 UTF-8 / UTF-8 BOM（自动剥）/ GBK / GB18030；写回统一 UTF-8 无 BOM；不可表示字符 → 弹"无法保存"明确错误，不静默吞漏。
- **不监听文件外部改动**：关闭时若检测到 mtime > 打开时 mtime → 弹「磁盘已变化」三选项（重新加载 / 保留我的修改 / 取消关闭）。

### 11.7.4 三平台分发杠杆（顶级漏斗入口）

| 平台 | 注册机制 |
|---|---|
| Windows | WiX/MSI 安装程序注册 `.md` 默认打开程序（`HKCR\.md` + ProgID） |
| macOS | `Info.plist` 通过 `CFBundleDocumentTypes` + `UTExportedTypeDeclarations` 注册 `net.daringfireball.markdown` UTI |
| Linux | `.desktop` 文件 `MimeType=text/markdown;`（deb / AppImage 安装时打入） |

资源管理器 / Finder / Nautilus 双击 `.md` → weavine 以纯编辑器打开（无上传惊吓）→ 用爽后按需「导入库」。这是 web/Android 做不到的顶级漏斗入口。冷启动 argv 通过 `tauri-plugin-single-instance` 转发到首实例（避免双击闪退或开多进程）。

### 11.7.5 文件大小策略

| 大小 | 编辑器态（打开/编辑/保存文件） | 「导入库」 |
|---|---|---|
| 任意大小 | **始终允许** | — |
| ≤ 1 MB | 正常 | ✅ 允许导入库 |
| > 1 MB | 正常（顶部轻量 banner） | ⛔ **置灰禁用**，提示「文件超过 1 MB，导入库会拖慢同步与备份」 |

> 编辑态不限制（只碰本地文件、不占云端）；「导入库」1 MB 阈值——避免单条 note 撑大 SQLite + 拖慢同步。

### 11.7.6 编辑器 MVP UX

**做**：编辑/预览分屏、主题跟随系统设置、自动保存**关闭（避免悄悄写用户文件）、脏标记 + 未保存拦截、行号/查找替换/字数统计、编辑器态隐藏关系面板（避免干扰"只想写个字"的用户，导入后才出现关联能力）。

**不做**：协同编辑、AI 补全、Vim mode、表格可视化、宏、插件；wikilink `[[xxx]]` 解析（保留原文以备未来升级为可选功能）。

### 11.7.7 导入即关联 + 导出闭环
- 「导入库」时弹 `EntityPicker`，并按正文 `@人名` 自动建议关联——把外来文件挂上关系网（weavine 相对 Typora / VS Code 的差异化）。
- 库内笔记支持「导出 `.md` 文件」回到磁盘形成闭环（数据可携）。导出文件**不含 frontmatter**——保留纯 markdown，未来若做双向同步可平滑升级。
- **重导入语义**（避免静默覆盖）：
  - 快速路径：文件 mtime ≤ `imported_at` → 自动跳过 + toast「已是最新」；
  - 冲突路径：文件 mtime > `imported_at` → 弹三选项（**更新已有笔记** / **跳过** / **作为新笔记导入**）。
- 导出 `.md` 时显式用 `setFileTimes` 把文件 mtime 设为 `imported_at`，让重导时走快速路径（若 FS 不支持改 mtime 则回退弹选择框）。

### 11.7.8 最近文件（Recent files）
- 本地 LRU 10 条 `{path, last_opened_at}`，不跨设备同步（路径无意义）。

### 11.7.9 数据模型（私有字段不上云）

- 桌面 SQLite `Note` 表新增 `imported_from TEXT` + `imported_at TEXT`——编辑器态导入的来源路径与时间留痕。
- 服务端 Postgres `note` 表**不加**这两列——本机路径上云泄露用户文件系统布局、跨设备无意义；sync translate 显式 drop。

### 11.7.10 平台范围
- **本期范围**：Windows / Linux / macOS 三桌面端均支持 `.md` 编辑 + 导入库 + 导出 `.md` + 文件关联注册 + 最近文件。三平台共用同一编辑器实现，差异仅在 bundle 元数据。
- **不在本期**：Web、移动端（库内已存在的笔记在 web/移动端已有能力可查看）。

### 11.7.11 不在范围（明确）
- 不做"保存双写文件+库"——彻底规避双副本分歧。
- 不把外部文件路径纳入云端同步（`imported_from` 在 server drop）。
- 不做协同编辑、外部编辑器插件、AI 补全、Vim mode、表格可视化。
- 不支持 `.markdown` / `.mdown` / `.mkd` 等扩展名变体（仅 `.md`，覆盖 99% 用例；变体可后续再加）。

### 11.7.12 OS 文件关联扩展到 docx / pdf / txt / html / htm / xlsx / pptx（v1.3.10，commit `86cb08c` / tag `v1.3.10`）

**需求**：§11.7 v1.3.6/v1.3.7 仅把 `.md` 注册为 OS 文件关联格式（Windows WiX ProgID / macOS `Info.plist` UTI / Linux `.desktop` MimeType）。本期扩展关联范围到 `md / docx / pdf / txt / html / htm / xlsx / pptx` 共 7 种——weavine 已能通过 `convert_external_file` 把后 6 类转 Markdown 编辑，OS 双击或「打开方式」应能找到并启动 weavine（漏斗断点：用户先开 weavine 再从应用内"打开文件"对话框）。

**拍板**：三平台（Windows / macOS / Linux）统一通过 `tauri.conf.json::bundle.fileAssociations` + `tauri-plugin-single-instance` 处理 argv；前端契约不变（`open-md-from-argv` 事件、`take_pending_md_path` 命令、`MdEditor` 转换流程），零前端改动；扩展名清单在 Rust 侧有单一真相源（`lib.rs::is_supported_argv`），与 `fileAssociations` 强同步。

**不在范围**：移动端 / Web 的 OS 关联；新增更多格式（`.epub` `.rtf` `.odt` 等）——等用户需要再加。

---

### 11.7.13 转换崩溃根治：独立进程隔离（sidecar，修复 v1.3.10 仍崩溃）

**现象**：Windows 下从应用内「📂 打开」选 `.docx`（或 `.pdf` 等）时，weavine 直接 crash 退出。

**根因**：`convert_external_file` 原在 32 MiB 栈的隔离线程里跑 `markitdown` 0.1.x 的 docx/pdf 转换，并用 `catch_unwind` 兜底。但 `catch_unwind` **只能拦第一次普通 panic**，拦不住两类必然 abort 的情况：
1. **栈溢出超过 32 MiB** —— `markitdown` 递归遍历 docx XML 节点，真实文档嵌套深时极易破 32 MiB；
2. **双重 panic** —— 转换中 panic 后某 `Drop` 又 panic，Rust 升级为 `abort`。

进程 abort = 整个 weavine 退出，即用户看到的"crash退出"。注释本身也写了 *"Stack overflow aborts the process; catch_unwind cannot catch it"* —— 32 MiB 只是抬高门槛，没消除崩溃。

**修复（独立进程隔离）**：复用主二进制自身做 sidecar，不再用线程：
- `src/main.rs` 在启动 Tauri **之前**拦截 argv：若带 `--md-convert-sidecar <path>`，直接跑 `convert::run_cli_convert(path)`（= `read_as_markdown` + 把 `ConvertResult` 以 JSON 打到 stdout + `exit`），不创建窗口、不初始化 single-instance。
- `convert_external_file` 改为 spawn 当前 exe（`--md-convert-sidecar <path>`）为**子进程**，读其 stdout 的 JSON；带 120s 超时，超时 `child.kill()`。
- 子进程若 abort（栈溢出/双重 panic），父进程只看到非 0 退出码 / 无有效 JSON → 返回友好错误 `转换器无法解析该文件`，**主进程绝不退出**。
- Windows 子进程里调 `SetErrorMode(SEM_NOGPFAULTERRORBOX)`（`windows-sys`）关掉 WER 崩溃弹窗，让 abort 静默、由父进程上报。
- 依赖新增 `windows-sys`（仅 `cfg(windows)`）。

**附带修复（同次 review 的 [高] bug）**：`App.tsx` 的 `open-md-from-argv` / `take_pending_md_path` 监听原本只 `navigate('?path=<原文件>')`、**没传 `external_path`**——导致通过系统「打开方式」/命令行双击 docx 时，`MdEditor` 走 `read_md_file` 把二进制当 `.md` 读成乱码、且不触发转换（v1.3.10 主打的"文件关联"对非 `.md` 实际失效）。现新增 `mdEditorUrlFor()`：非 `.md` 格式自动算兄弟 `<name>.md` 作为编辑目标、原路径作 `external_path`，与 in-app 对话框行为一致。

**验证状态**：代码已落地（main.rs / convert.rs / App.tsx / Cargo.toml），待 opencode `cargo build` 编译确认。`windows-sys` feature 名 `Win32_Foundation` 需编译核对。

**回归点**：双击 `.docx` / `.pdf` 应打开转换后的 Markdown 编辑器且 app 不崩；故意喂畸形大 docx 时 app 仍存活、仅提示"无法解析"。

---

## 11.8 全局搜索架构定稿（2026-08-24 拍板）

> **状态**：已拍板，待实施（跟踪编号 #47，见 §8）。
>
> **合并来源**：本节原为「工作区维护版」独有，2026-09-26 合并回本文档（该副本的 §11.7 与本节的 §11.7「md 文件编辑器」编号冲突，故此处顺延为 §11.8）。

### 11.8.1 现状（重要前置发现）

- 后端 `business/search.rs` + `commands/search.rs`：**跨联系人 / 互动 / 日程 / 待办 / 项目 5 类实体的 LIKE 搜索**，已就绪。
- 前端 `Search.tsx`：完整的分页结果页（按类型分组、归档开关），已写好。
- **但 UI 中无任何入口**：全代码搜索下来，BottomNav 的 4 个主标签 + MoreSheet（projects / tags / archive / settings）均无链接到 `/search` → 是「孤儿页」，功能完备却进不去。
- 结论：痛点不是「没有搜索」，而是「没有入口、且不想为它再加菜单项」。

### 11.8.2 拍板原则

- **⌘K / Ctrl+K 保留给 QuickCapture**（说一句话 → 解析成新记录 = **写**）。已核实 `App.tsx:66` 的 `useGlobalShortcut('k', setQuickOpen)` + Tauri 系统级 `ctrl-k-pressed` 绑定。搜索**不抢 ⌘K、不共用输入框**——写 / 读语义相反（QuickCapture 把文字当「要解析的新记录」，搜索当「查询词」），无法兼得。
- **不新增菜单项**：入口挂在常驻控件上，不扩 BottomNav 主标签、不塞 MoreSheet。

### 11.8.3 入口设计（不增菜单）

| 端 | 入口 | 说明 |
|---|---|---|
| **桌面** | 左侧栏顶部常驻 🔍 输入框 | 点开即筛 / 展开浮层；不依赖快捷键，永远可见 |
| **移动** | BottomNav 加 🔍 图标按钮 | 当作「动作」而非「页面菜单」→ 打开 `/search` 页或浮层 |
| **可选快捷键** | `/`（单斜杠，GitHub / Gmail 风格）聚焦搜索框 | 与 ⌘K 不冲突；加守卫「当前焦点不在输入框内才触发」 |

**⌘K = 记（写），🔍 / `/` = 找（读）**：两个独立入口，正好对应「记 vs 找」，不该合并。

### 11.8.4 形态（两期，避免过度）

- **一期（低成本、高价值）**：把现有 `search` command 包进浮层 / 侧栏框，键盘流 `↑↓` / `↵` / `Esc`，结果按类型分组（联系人 / 互动 / 日程 / 待办 / 项目，带图标 + 标题 + 副信息）；「查看全部结果 →」跳现有 `/search` 页复用。几乎只是 UI 搬运 + 事件监听。
- **二期（差异化 = AI 关系教练 ④ 自然语言查询）**：同浮层加 NL 模式——「上月展会认识、还没二次联系的」→ 服务端 LLM 翻译成结构化查询，跑已捕获的数据。依赖记录质量（GIGO），放二期。

### 11.8.5 与既有决策的一致性

- §7.1「Ctrl+K 范围 = 创建为主；**拒绝** 全局搜索 + 命令面板 + 主题切换」→ **本拍板不推翻**：搜索不并入 Ctrl+K 命令面板，而是独立的「读取」表面。
- §3.5.8「❌ 全局搜索 / 命令面板扩展（仅创建 + 跳转联系人详情）」→ 指该 §3.5 计划**不捆绑**搜索；搜索现作为独立已拍板特性（本条），不属该计划范围。
- 关联：#47（功能跟踪）、AI 关系教练 ④（§12 #20）。

---

## 12. 产品调研与新功能提案（2026-08-17 独立撰写，待拍板）

> **状态**：草稿，待用户回来 review 后进入 Phase 3 实施。**不发布新版。**

### 12.1 调研背景

- **当前实现面**（v1.0.11，git HEAD `877ade7`）：
  - **27 routes**（`apps/web-spa/src/routes-config.tsx` 唯一真相源）：Login、Today、Contacts × 5、Calendar、Events × 3、Actions × 4、Projects × 4、InteractionDetail、Reminders、Tags × 2、Search、Settings × 2、Archive
  - **23 components**：AppShell / Avatar / AvatarCropModal / AvatarViewModal / CardImageViewModal / CardScanner / CategoryPicker / ContactBadge / ContactMultiPicker / ImportancePicker / PageHeader / PickerEmptyState / Popover / PriorityPicker / ProjectBadge / QuickCapture / QuickFab / ReminderToast / RescanCardModal / SearchablePicker / StatusPicker / TagPicker / categoryPresets
  - **22 server handlers**（`server/src/handlers/`）：action / activation / api_key / archive / auth / contact / diagnostic / event / graph / interaction / media / mod / ocr / project / project_contact / quick / reminder / search / setting / storage / sync / tag / voice
- **已完成需求**：§8 显示 #3 / #12 P0；#4 / #5 / #11 / #1 / #13 / #14 / #15 P1；#8 P3。
- **未实现需求**：§8 P2 #9 #6 + #16 #17 #18；P3 #10 #2 #19 #20。
- **全盘回归**（2026-08-17）：`cargo test src-tauri --lib` 37/37、`cargo test server --bins` 11/11、`npx tsc --noEmit` clean、`npx playwright test` 12/12 全绿。

### 12.2 现状评估（按 PRM 核心竞争力）

| 维度 | 状态 | 评价 |
| --- | --- | --- |
| **关系捕获** | ✅ 双向已闭环（#3 关系模型 + 关系图谱 #4） | 核心壁垒已建 |
| **快速记录** | ✅ QuickCapture 已落地（Ctrl+K + Android 语音 + 时间 tie-breaker v1.0.11） | 体验顺 |
| **节奏提醒** | ✅ Cadence Hub + 原生通知（§3.6 + §3.5） | 留存主力 |
| **多端同步** | ✅ sync v0.2.0b 已闭环（F1–F6） | 跨端无感 |
| **本地导入** | ❌ 完全缺失（#16 未做） | 数据入口短板 |
| **AI 教练 / 简报** | ❌ 完全缺失（#17 #18 #20 未做） | 高价值、未启程 |
| **数据可视化** | 🟡 关系图谱有、机会看板 / 漏斗无（#19 未做） | 决策辅助空白 |
| **协作 / 团队** | ❌ 明确不做（单租户个人 CRM 定位） | 不在路线 |

### 12.3 调研方法

调研覆盖三类来源：
1. **代码现场**：routes/components/services/business 目录结构 + 已有 TODO/FIXME 注释 + 最近 30 天 commit message 中的用户反馈
2. **spec 现有 backlog**：§3 P2/P3 编号 #6 #9 #10 #2 #16 #17 #18 #19 #20 重新评估依赖、价值、实现路径
3. **同类产品参考**（PRM / 个人 CRM / 网络笔记）：
   - **Monica CRM**（个人关系管理标杆）：日记流 / 提醒 / 礼物建议 / 关系类型标签
   - **Clay**（关系网络图谱）：自动联系频率建议 / 关系健康度 / 上下文卡片
   - **Notion / Roam Research**（双链笔记）：块引用、嵌入、tag、backlink
   - **Day One / Journey**（日记）：每日回顾 + 时间轴 + 模板
   - **HubSpot / Salesforce 个人版**（B2C CRM）：阶段、漏斗、活动日志
   - **微信 / 飞书**（中国 IM 上下文）：朋友圈、聊天记录、通话记录、文件传输
   - **Notion Calendar / Cron / Reclaim**（时间块）：自动时间块 + 节奏建议

### 12.4 新功能提案（按 P0/P1/P2/P3 排序，需用户拍板）

#### 🔴 优先级：数据入口（短期内必做，否则用户自己流失）

##### 🆕 #21 通讯录 + 通话记录本地导入（Android）

- **价值**：补"微信黑盒"数据缺口，是用户最强烈的导入诉求。
- **核心 UX**：Android 设置 → 数据导入 → 授权 Contacts + CallLog → 后台增量同步到本地 Contact（按 phone last-4 fuzzy match 去重）。
- **依赖**：Android `READ_CONTACTS` / `READ_CALL_LOG` 权限（已在 manifest？需查）。
- **工作量**：~5 人/日（含权限流 + 去重 + UI + e2e）。
- **风险**：Android 11+ Scoped Storage + Call Log 权限收紧，需降级方案（仅 Contacts）。
- **关联**：合并现有 #16（提案相同，合二为一）。

##### 🆕 #22 名片扫描 + 群发（卡片导入多联系人）

- **价值**：会议上收到一堆名片，一次拍下来自动识别多个联系人的字段，减少重复录入。
- **核心 UX**：拍摄含多张名片的图片 → server 端 multi-card OCR（切割 + 识别 + 字段合并）→ 弹出多联系人确认面板 → 批量创建。
- **依赖**：Tesseract multi-region + 卡片检测算法（YOLO 或简单矩形检测）。
- **工作量**：~8 人/日（模型训练 / 标注数据 / server 集成 / UI 流程）。
- **风险**：OCR 精度依赖训练数据，先用规则矩形检测 + 手工分割兜底。
- **关联**：扩展现有 #11 名片 OCR（已实现单张）。

##### 🆕 #23 微信 / 飞书聊天记录导入（解析 SQLite）

- **价值**：用户最大诉求：把历史聊天数据落入 CRM。
- **核心 UX**：用户从手机导出聊天记录（微信 WeChat Backup / 飞书 export）→ 在桌面端解析 → 自动按 contact + 时间匹配到 Interaction。
- **依赖**：微信 DB 解密（EnMicroMsg.db 密钥推导，需用户输入 IMEI 或 root），飞书导出 JSON。
- **工作量**：~12 人/日（解密 + 解析 + 匹配 + UI），且有法律灰色地带。
- **风险**⚠️：微信备份解密可能违反微信 ToS，且密钥推导依赖用户手机 IMEI（隐私敏感）。**建议暂不做，提供导出 .txt 的手动导入路径**（用户合规风险自负）。
- **关联**：替代 #18（聊天洞察）的数据源。

#### 🟠 优先级：智能化（产品差异化）

##### 🆕 #24 关系健康度评分（每日计算 + 卡片展示）

- **价值**：让用户"看见"哪些关系在降温，主动出击。
- **核心 UX**：ContactDetail 顶部加一个 "健康度" 进度条 + 三色（绿/黄/红）+ Tooltip 解释因子（最近互动距今 / 频率 vs Cadence 目标 / 上次情绪 / 关系强度）。
- **依赖**：本地计算，无 server 依赖。
- **工作量**：~3 人/日（公式 + UI + e2e）。
- **数据点**：`last_interaction_at` / `cadence_target_days` / `interaction_count_30d` / `emotional_sentiment_avg`（#25 之后才有）。
- **关联**：与 Cadence Hub（§3.5.5）联动，节奏提醒的"为什么联系"原因。

##### 🆕 #25 互动情绪分析（NLP 标签）

- **价值**：在 Interaction 上自动打"积极 / 中性 / 消极"标签，长期看关系走向。
- **核心 UX**：Interaction 创建后，server 跑轻量 sentiment 模型（中文用 snowNLP / 英文用 VADER）→ 返回 label + score → UI 显示小图标。
- **依赖**：server 端集成 NLP 库，或客户端调用 ONNX 模型（桌面 / Android 可本地）。
- **工作量**：~5 人/日（模型集成 + API + UI）。
- **风险**：模型准确度（中文口语化 + emoji），前期可仅作辅助标签。
- **关联**：#24 健康度评分的输入因子。

##### 🆕 #26 AI 会议简报（与 #17 合并）

- **价值**：开会前 30 分钟弹一条 "你与张三的 5 次互动 + 最近的 3 个话题 + 待跟进项"。
- **核心 UX**：EventEdit / EventDetail 加 "生成简报" 按钮 → server 端 fetch 该 contact 的最近 N 个 Interaction + Action → LLM 总结（用本地 Ollama 或 server 端 GPT）→ 渲染到卡片。
- **依赖**：本地 LLM（Ollama / llama.cpp）或 server 端 API key。
- **工作量**：~6 人/日（LLM 集成 + prompt 设计 + 卡片 UI）。
- **关联**：合并现有 #17。

#### 🟡 优先级：生产力

##### 🆕 #27 联系人导出（vCard / CSV）

- **价值**：本地 CRM 用户最基础诉求：能导出来（迁移、备份、跨工具）。
- **核心 UX**：设置 → 数据 → 导出全部联系人 → 下载 .vcf（vCard 3.0 / 4.0）或 .csv。
- **依赖**：无。
- **工作量**：~1 人/日（vCard 序列化 + 触发下载 + e2e）。
- **风险**：无。

##### 🆕 #28 联系人分组 / 列表（标签之上的更结构化分组）

- **价值**：Tag 是 flat，Group 是 nested（"客户 > A 公司 > 张三"）。许多用户已有 mental model。
- **核心 UX**：ContactNew / ContactEdit 加 "分组" Picker（树状），ContactList 加按分组筛选。
- **依赖**：新建 `contact_group` 表 + 多对多关联表 `contact_group_member`。
- **工作量**：~4 人/日（schema + UI + sync + e2e）。
- **风险**：与 Tag 功能重叠，需拍板：Tag 是属性、Group 是容器（互斥？）还是共存。
- **建议拍板问题**（§7 新增 Q）：Tag vs Group 边界。

##### 🆕 #29 快速记录模板（场景化预填）

- **价值**：销售 / 招聘 / 投资等场景有固定结构，预填字段减少认知负担。
- **核心 UX**：QuickCapture 加 "模板" 按钮 → 选择模板（如"销售线索"= 联系人 + 公司 + 需求 + 预算 + 下一步）→ 预填 textarea → 用户编辑 → 提交。
- **依赖**：新建 `quick_capture_template` 表。
- **工作量**：~3 人/日（schema + UI + 模板插入 pipeline）。
- **关联**：扩展 §3.5 QuickCapture 子系统。

##### 🆕 #30 关系图谱增强（影响力 / 中心度）

- **价值**：让用户看到"谁是网络核心节点"（帮用户识别关键人脉）。
- **核心 UX**：GraphView 加开关："显示中心度" → 节点大小/颜色映射 degree / betweenness centrality（基于一跳子图）。
- **依赖**：本地算法（networkx 风格），无 server。
- **工作量**：~3 人/日（算法 + UI + e2e）。
- **关联**：扩展现有 #4 关系图谱。

#### ⚪ 优先级：实验性 / 远期

##### 🆕 #31 联系人头像自动生成（字母 / 渐变色）

- **价值**：用户没传头像时，显示当前 initials 的灰色头像（当前是 fallback），改成品牌感的字母渐变头像。
- **核心 UX**：Avatar 组件 fallback 渲染：从姓名首字母 → 根据 hash 选择 12 色之一 → 圆形 + 渐变背景。
- **依赖**：纯前端 CSS gradient。
- **工作量**：~0.5 人/日。
- **风险**：无。

##### 🆕 #32 微信小程序入口（只读视图）

- **价值**：用户手机上快速查看某个联系人的信息卡片（不用打开桌面 App）。
- **核心 UX**：开发微信小程序 → 微信扫码登录 → 拉取云端数据 → 只读视图。
- **依赖**：server API + 小程序开发 + 微信开放平台认证。
- **工作量**：~10 人/日（含审核）。
- **风险**：需企业认证 + 域名备案 + 微信审核（中国合规）。
- **关联**：与 #9 云服务器选型联动。

##### 🆕 #33 数据可视化仪表盘（个人 CRM 主页）

- **价值**：让用户登录后第一眼看到"我的关系网络健康度"：联系人总数 / 本周新增 / 逾期未联系 / 情绪分布。
- **核心 UX**：默认路由改到 `/dashboard`（原 `/contacts`）→ 4 个 KPI 卡片 + 趋势图。
- **依赖**：聚合查询 + 简单图表库。
- **工作量**：~5 人/日。

##### 🆕 #40 md 文件编辑器 + 显式「导入库」（桌面三端）

- **价值**：把 weavine 变成日常 `.md` 编辑器（扩大使用范围、提高打开频次与粘性）；用「导入库」把外来知识桥接进 PRM 关系网与 AI 上下文，是 C4「第二大脑」的顶级漏斗。
- **核心 UX**：双击 `.md` → weavine 以纯编辑器打开（Windows / Linux / macOS 三桌面通用），保存只写文件、不写库、不同步；点「导入库」才复制进笔记库并支持关联联系人/待办/日程。
- **架构**：见 §11.7（三态模型 + 显式桥接 + 文件关联注册）。
- **平台**：Windows / Linux / macOS 三桌面端；Web/Android 不在本期。
- **依赖**：#26 笔记体系、EntityLink、三端安装注册 `.md` 文件关联。
- **工作量**：编辑器复用现有 MarkdownEditor/MarkdownView；主要为导入桥接 + 文件关联注册 + 来源留痕，约 3–5 人/日。
- **风险**：编辑器打磨勿与 Typora/VS Code 死磕，差异化在「关系联网」而非 textarea。

### 12.5 实施路径建议（待拍板）

如果用户批准，建议的 Phase 3 推进顺序（按 ROI 排序）：

| 阶段 | 内容 | 估时 | 价值 |
| --- | --- | --- | --- |
| **Phase 3.1** | #27 导出 + #31 字母头像 + #24 健康度评分 | ~5 人/日 | 快速胜利、提升日常使用 |
| **Phase 3.2** | #21 通讯录导入 + #22 群名片扫描 | ~13 人/日 | 数据入口短板、补"微信黑盒" |
| **Phase 3.3** | #25 情绪分析 + #26 AI 会议简报（LLM 集成） | ~11 人/日 | 智能化跃迁、产品差异化 |
| **Phase 3.4** | #28 分组 + #29 模板 + #30 图谱增强 | ~10 人/日 | 生产力与可视化 |
| **Phase 3.5** | #23 微信聊天导入（合规审查后）+ #33 仪表盘 | ~17 人/日 | 长期主线 |

合计 ~56 人/日（按一人/日 8h 算）。建议至少 Phase 3.1 + 3.2 优先，对应用户最强烈的"补数据"诉求。

### 12.6 现有 P2/P3 backlog 重新评估（与新提案的关系）

| 编号 | 现有描述 | 处理 |
| --- | --- | --- |
| #6 Onboarding + 套餐 | P2 暂缓 | **保留**，但前置条件是云服务器 (#9) + LLM (#26)。Phase 3.3 后启动。 |
| #9 云服务器选型 | P2 | **前置**（#26 #32 都依赖）。建议先用 prod 已有的 `weavine.financialagent.cc`，暂不切。 |
| #10 移动端小模型 MCP | P3 | **合并**进 #25（NLP 模型本地推理）。 |
| #2 合影取头像 | P3 | **保留**但推迟到 Phase 3.4 之后，依赖 #1 头像已成熟。 |
| #16 通话/通讯录本地导入 | P2 | **合并**为 #21（提案升级：通讯录 + 通话记录一起做）。 |
| #17 会议准备简报 | P2 | **合并**为 #26（AI 简报 + LLM 集成）。 |
| #18 引荐洞察 | P2 | **保留**到 Phase 3.3 后做，依赖 #26 LLM 基础设施。 |
| #19 机会看板 | P3 | **保留**，但挪到 Phase 3.5。 |
| #20 AI 教练 + 消息起草 | P3 | **合并**进 #26（LLM 集成是同一个技术栈）。 |

### 12.7 不在本调研内（明确）

- ❌ **多用户协作 / 共享空间** —— 与"个人 CRM"定位冲突，§10 已明确不做。
- ❌ **第三方数据接入（LinkedIn / 微博 / Twitter）** —— 中国合规 + 数据驻留问题，且数据来源不稳定。
- ❌ **AI 自动联系（自动发邮件 / 自动发微信）** —— 越权 + 体验糟糕 + 反 spam 法律风险。
- ❌ **语音 / 视频通话集成** —— 不在产品边界内，交给专业工具。

### 12.8 拍板记录（本节增项）

待用户回来 review 后填写：
- **Q10 调研范围是否覆盖足够？** → 用户拍板
- **Q11 优先推进 Phase 3 哪些？** → 用户拍板
- **Q12 #23 微信聊天导入是否做？合规审查？** → 用户拍板
- **Q13 #28 Tag vs Group 边界怎么定？** → 用户拍板
- **Q14 Phase 3 总节奏（每周 / 每月 / 一次性）？** → 用户拍板
- **#40 md 文件编辑器 + 显式导入库（2026-08-26 拍板，定稿见 §11.7）**：桌面三端打开 `.md` 仅作纯编辑器（不写库/不同步），「导入库」显式桥接进 #26 笔记库；安装注册为 `.md` 默认打开程序作为分发入口。

---

## 13. ~~代码现场发现的 quick wins / 缺口~~（已删除：bug 巡检清单）

## 14. v1.3 关联图 + 归档→互动 改写（2026-08-27）

### 14.1 动机

v1.2 的关联图把"动作"和"事件"自动展开为互动，导致同一工作流（待办完成 / 日程结束）被记成两份记录：一份原始实体 + 一份互动。归档后才时把它们折叠为一条互动，避免重复；UI 也从动作中心改为待办中心，统一术语。

### 14.2 UI 改写（`GraphView.tsx`）

| 项 | 之前 | 之后 |
| --- | --- | --- |
| `action` label | 动作 | **待办** |
| `event` label | 事件 | **日程** |
| `tag` 节点 | 显示在 graph，可钻取 | **从 graph 移除**（`RING_LEVEL` / `SUPPORTED_CENTERS` / `detailHref` 三处同步删掉） |
| 钻取按钮 | `⊕`（"加号"语义） | **`↗`**（指向，节点为中心视图） |
| 提示文案 | "标签节点不可钻取" | 删除（无 tag 节点后该提示已过时） |

`entity_type` 字符串值不变（仍为 `action` / `event`），仅 UI 文案与可视节点集合变化。`/tags/:id` 详情页保留，标签功能本身不受影响。

### 14.3 归档→互动拍板

v1.2 在 Action `status=done` / Event 结束时即时写 Interaction，导致同一工作流被记成两份。v1.3 改为**仅归档时**转移为单一 Interaction：

- Action / Event `archived_at` 由 None 变为 Some 时新建 `source='archive'` 的 Interaction（`source_ref = action/event.id`），并复制其 `NoteEntity` 关联到新 interaction 上。`occurred_at` 优先用 `completed_at` / `end_at`，否则用 `archived_at`。
- `auto_log.rs` 退化为 `contact bump only`（仅提升 `Contact.last_interaction_at`，不再写 Interaction）。
- `Interaction.source` CHECK 约束扩列加 `'archive'`。

### 14.6 跨栈一致性

- Server 侧 (`server/src/handlers/action.rs` / `event.rs` 的 `update` handler) 暂不改动 —— 用户仅在 Desktop 客户端归档；Server 走 sync 接收 `archived_at` 字段后由 `sync/translate.rs` 落库，Interaction 写入逻辑未来要后 port。当前 Desktop-first 是 v1.3 范围内的 scope。

### 14.7 拍板记录（本节增项）

- **Q19 v1.3.1 是否要补 Server 侧 archive 钩子**（保证 cloud 用户归档后云端也有 Interaction）？→ 用户拍板。
- **Q20 `auto_log.rs` 是保留（仅 bump contact）还是彻底删掉**？当前保留，用户可能想彻底关掉。→ 用户拍板。

---

## 15. 归档数据生命周期：自动清理（2026-09-26 拍板并落地，v1.6.2；同日二次拍板：默认 30 天 + contact 纳入）

### 15.1 动机

归档不是删除。归档的待办 / 项目 / 日程 / 笔记 / 联系人会**永久留在库里**，而且因为每次变更都进 `sync_change_log`，它还会被反复投递给每一台设备。用户反馈「已归档太多，一直累积下去」——归档语义若不设终点，数据与日志都会无界增长。

### 15.2 拍板

| 项 | 决定 |
| --- | --- |
| 清理方式 | **硬删**（不是再补一层软删）。走正常 `sync_log_change()` 触发器，因此 `op='DELETE'` 会**同步到所有端**——只在服务端删会让客户端下次 push 把行复活 |
| 默认保留期 | **30 天**（`ARCHIVE_RETENTION_DAYS`）。初版定为 90 天，2026-09-26 二次拍板下调为 30 天 |
| 逐用户覆盖 | 同步的 `setting.archive_retention_days`；**`0` 或负数 = 永久保留**；解析失败回落默认值（不因一个用户的脏设置中断整轮清理）。**【2026-09-26 §18 补充】下限 7 天**（`MIN_RETENTION_DAYS`）—— 该值驱动的是不可撤销的硬删，而它是 `setting` 表里的自由文本、任何客户端都能改，`30` 敲成 `3` 会提前毁掉一个月的历史。可达性：`POST /api/settings/upsert`（无 key 白名单）**已可用**，两端 UI 尚未提供 |
| 覆盖范围 | `action` / `project` / `event` / `note` / **`contact`**。⚠️ **【2026-09-26 §18 澄清】`contact` 目前是惰性条款**：列、快照过滤（§18 的 F16 补齐）、清理谓词都在，但**没有任何入口能把一个联系人置为已归档**（服务端 handler / web `Archive.tsx` / 桌面 `archive.rs` 都只认 Action / Event / Project） |
| 清理的两个时钟 | ① `archived_at < cutoff`（归档到期）；② `deleted_at < cutoff`（**墓碑到期**）。客户端只做软删，墓碑一旦传播完成就既不可见也不可编辑，留着只会堆积；扫掉它同时收掉"删除后又被客户端 push 回来"的残留 |
| 多态引用清理 | `note_entity`（`entity_type`/`entity_id`）与 `media`（`owner_type`/`owner_id`）**没有外键**，PG 无法级联 → 单独扫孤儿；否则反链指向已不存在的人，头像字节（`media.blob`）永不释放——而字节正是清理要回收的空间 |
| 调度 | 启动后 10 min 首跑，之后每 6 h（`ARCHIVE_PURGE_INTERVAL_SECS`） |
| 安全边界 | 只删满足上述两个时钟之一的行；`archived_at` / `deleted_at` 的**字符串格式必须与全栈 Z 格式一致**（`%Y-%m-%dT%H:%M:%S%.3fZ`），否则比较会静默失效（永不清理或一次清光） |

**级联**：删父行会级联到有外键的子行（project → project_contact、event → reminder、**contact → contact_tag / project_contact / reminder**），这些写入同样触发触发器，因此一并传播。

**互动历史刻意保留**：`interaction.contact_id` / `event.contact_id` / `action.contact_id` 都是 `ON DELETE SET NULL` —— 联系人被清理时**只断开关联，不删记录**。"和谁吃过饭"这段历史是本产品的核心资产，它的价值不因联系人行消失而消失。清理一个 30 天前归档的联系人，代价是失去他的标签、项目成员关系与提醒，**不是**失去与他的互动记录。

### 15.3 连带修复

归档清理依赖「删除能传播」，而清理（尤其把 contact 纳入后必然触发的 `contact → reminder` 级联）暴露出**删除根本无法执行**的缺陷（已修）：

1. **客户端本地 `Reminder` / `Interaction` 表没有 `updated_at` 列**，但 `reminder::delete` / `event::delete`（连带删提醒）/ `interaction::delete` 都在写它 → SQLite 报 `no such column: updated_at`，**删提醒 / 删事件 / 删互动一律失败**；服务端 `handlers/tag.rs` 的删标签同样写了 PG `tag` 表上不存在的 `updated_at` → 必 500。这些表都不在 `UPDATED_AT_TABLES` 内，墓碑由 `deleted_at` 承载即可，故直接去掉该列写入。**⚠️ 这条结论的成立前提已被同日后续的 §16 改动推翻**：`tag` / `interaction` / `reminder` 已补上 `updated_at` 并纳入 `UPDATED_AT_TABLES`，现在这三处的删除**必须**同时写 `deleted_at` 与 `updated_at` —— 否则墓碑的时间戳会低于 push 水位，删除根本传不出去（即 §16.4 的连带修复之一）。
2. **同步热路径同类缺陷（本次新修）**：`sync/mod.rs::apply_change` 的 DELETE 分支对所有非 junction 表一律写 `"deleted_at" = ?, "updated_at" = ?`。但 `Tag` / `Interaction` / `Reminder` 本地表**没有 `updated_at`** → 拉取到这三类 DELETE 时直接报错并**中断整个 pull 事务**：一条被删的提醒，会让该设备之后所有变更都同步不进来（且是静默的——只有日志里有）。现按 `UPDATED_AT_TABLES` 白名单决定是否写该列，并补回归测试（§16 落地后该测试改名为 `pull_delete_marks_tombstone_and_bumps_updated_at`，断言同时覆盖「墓碑落地」与「`updated_at` 随之推进」两半）。**这条对本次改动是前置项**：contact 纳入清理后，每个到期联系人都 CASCADE 出一批 reminder DELETE，不修则客户端 pull 必崩。

> 教训：`UPDATED_AT_TABLES` 既是 push 的时间过滤依据，也必须是"这张表有没有 `updated_at`"的唯一真相源。任何按表名动态拼列的地方都要先问它一句。

### 15.4 拍板记录（2026-09-26）

- **Q21 保留期默认 90 天是否合适**？→ **拍板：30 天**。归档是"中转站"不是"冷库"；真要长期留存的东西不应走归档路径。
- **Q22 清理是否需要用户可见的提示**？→ **未拍板，维持静默硬删**。`setting.archive_retention_days` 已可逐用户覆盖（写库即生效），设置页说明留待后续。
- **Q23 是否给 contact 一条更保守的路径**（永久保留 + 手动批量清理）？→ **拍板：contact 也纳入清理**，与其它表同一保留期。理由：归档满 30 天的联系人对用户已不在工作集内，留着会让其标签关联、项目成员关系与提醒永远活着。互动历史因 `SET NULL` 不受影响（见 §15.2）。

### 15.5 遗留（已知未做）

- **客户端本地墓碑不参与本 sweep**：服务端删除经 pull 传播，但客户端自身的软删行会留在本地 SQLite 里。影响面远小于服务端（本地库小、不外传），若要清理需在客户端加同样的时间窗口，且**窗口不能早于服务端**——否则离线设备会把已删行 push 回服务端，形成来回。
- **服务端不会主动通知"某行即将被清理"**：客户端只能通过 DELETE 变更感知。若某设备离线超过 30 天（清理已发生）且超过 `CHANGE_LOG_TTL_DAYS`（90 天，变更日志已剪），则靠快照 bootstrap 的墓碑（`TOMBSTONE_KINDS` 的 8 类）恢复一致性——两个窗口的先后关系（30 < 90）是这套设计成立的前提，调整任一项时须一并复核。

---

## 16. 同步增量化：LWW 补全（2026-09-26 拍板并落地）

### 16.1 问题：F8 只止住了「越同步越慢」，没止住「一直慢」

§2.3 的 F8（change-log no-op 守卫）解决的是**日志无限膨胀**那一半；push 侧那一半原封未动。

`push_all` 对不在 `UPDATED_AT_TABLES` 内的 kind 生成的查询**没有时间过滤**（只有 `WHERE user_id = ?`），于是 `tag` / `interaction` / `reminder` 三张表**每轮无条件全量上传**——每 30 分钟一次，与「这轮有没有改动」完全无关。`interaction` 是随使用持续累积的表，因此每轮成本随数据量线性上升。

叠加当时「服务端每行无条件 upsert + 触发器每行记一条日志」的旧行为，每轮上行还≈下行（变更日志会原样回灌给同一台设备，因为 `pull` 的 `WHERE user_id = $1 AND server_revision > $2` **不排除来源设备**）。**F8 之后 pull 的下行已接近归零，但上行原样保留** —— 这就是本节要收掉的部分。

### 16.2 拍板

| 项 | 决定 |
| --- | --- |
| 新增 LWW 列 | `tag` / `interaction` / `reminder`，两端各加 `updated_at TEXT`，并纳入两端 `UPDATED_AT_TABLES` |
| 四张 junction 表 | **明确不做**（见 §16.6 第 1 条）：它们缺的不是 `updated_at` 而是**删除传播**。给它们加 `updated_at` 只能省流量、却会掩盖更严重的语义缺陷；且一旦某个写入点漏维护，行会**永远推不上去**（比现状更糟） |
| backfill 哨兵值 | `1970-01-01T00:00:00.000Z`，两端语义**刻意相反**：客户端用它填存量行（让 `updated_at > ''` 成立，保证升级后这些行仍可被选中推送）；服务端**留 NULL**（NULL = 无版本信息 → LWW 分支直接接受客户端值）。若客户端不留值，存量行会因 NULL 永不入选而**静默停同步** |
| 时间格式 | 唯一来源 `business::lww_now()`（RFC3339 + 3 位毫秒 + `Z`）。**禁止**用 SQLite `CURRENT_TIMESTAMP`——它产出 `2026-09-26 19:30:00`（无 `T`、无时区），服务端 `normalize_lww_timestamp` 解析不了，比较会退化为按字节比（空格 `0x20` < `T` `0x54`），导致**客户端永远赢**、与先后顺序无关 |
| 旧客户端兼容 | 服务端把「payload 缺 `updated_at` 字段」判定为**无 LWW 信息 → 直接接受**。**不能**默认成空串：`""` 输给任何真实时间戳，会让所有未升级客户端的 tag/interaction/reminder 写入全部被拒，且该设备**静默**停同步这三类 |

### 16.3 上线次序（硬要求：服务端必须先发）

push 的 `SET` 子句由 payload 自身的 key 生成，因此新客户端会产出 `updated_at = EXCLUDED.updated_at`。若服务端表还没有该列，PostgreSQL 会拒绝**整条语句**（`column "updated_at" of relation "tag" does not exist`）→ push 直接 500。

> 这里容易猜错：`jsonb_populate_record` **本身会忽略**未知字段，真正让次序变成硬要求的是那条**显式写出的 SET 子句**引用了该列。

反方向无需协调：旧客户端不带该字段，服务端接受、且**不会清掉**已有值（SET 子句不含它）。因此客户端可以按自己的节奏升级。

### 16.4 连带修复

1. **本项目 schema 存在多套定义，且重建顺序会吃掉新列。** `migration.rs` 除 `SCHEMA_SQL` 外，`migrate_legacy_columns` 的 `rebuild!` 字面量与「扩展 `Interaction.source` CHECK」的字面量各自重复了一份表结构；而**后者跑在加列循环之后** → 刚加上的列立刻被它用旧字面量重建掉。已修该字面量（含 `INSERT … SELECT` 的列清单，避免丢值），并在 `migration::run` **末尾**加「最后防线」：幂等 re-assert 这三列 + backfill，使最终状态与「哪次重建跑过」无关，同时修复已被旧版本重建过的库。
2. **`interaction::update` / `reminder::update` 缺空 SET 保护**：无字段变更时会生成 `UPDATE X SET  WHERE id = ?1`（语法错误）。加入 `updated_at` bump 后 SET 列表恒定非空，顺带堵住。
3. **`record_push_retry` 的适用范围自动收窄**：这三类此前依赖「每轮全量重推」隐式重试被拒的行，现在改为按主键 + 退避重试（与其它 LWW kind 一致）。

### 16.5 守卫测试（本次的防复发设计）

| 测试 | 位置 | 作用 |
| --- | --- | --- |
| `column_lists_agree_with_real_schema` | 客户端 | 对**真实 migration** 跑一遍，断言 `push_columns` 每一列都存在于对应表；并双向断言 `UPDATED_AT_TABLES` ↔「表是否真有该列」。**本次实际抓到了 §16.4 第 1 条的「重建丢列」缺陷**——若只用手工 fixture，这个 bug 会直接进生产 |
| `updated_at_tables_is_the_expected_set` | 客户端 | 钉住清单内容；清单变化时测试失败，强制去同步服务端镜像 |
| `migration_backfills_updated_at_on_predating_rows` | 客户端 | 用「已是旧结构且已有数据」的表跑迁移，断言不留 NULL（这是「静默停同步」的唯一护栏） |
| `updated_at_tables_are_real_sync_tables` | 服务端 | 防表名拼写错。服务端这份清单存的是**表名**（不是 kind），而 `contains()` 拼错只返回 false、**不报错**，表现是静默退回全量重推 |

### 16.6 遗留（本次刻意未做）

1. **junction 表的删除不传播**：`ContactTag` / `ProjectContact` 本地是复合主键、无 `id` 也无软删列，删除走 `DELETE FROM …` —— 行没了，push 就选不到它，服务端完全不知情，多设备下该关联会**复活**。修它需要引入软删语义（改查询过滤 + 复合键处理），应与 `updated_at` 一起设计，而不是拆开做。
2. **`reminder::sync_event_reminder` 用硬删**（`DELETE FROM Reminder WHERE event_id = ?1 AND kind = 'time'`），绕过 `deleted_at`，与 `event::delete` 的软删语义不一致 → 服务端会残留孤儿提醒，且删除无法传播。
3. **push 水位依赖客户端时钟**：时钟超前的设备会把水位推到未来，使之后时间戳更早的真实变更推不上去。既有问题（现有 7 张 LWW 表同样如此），非本次引入。

---

## 17. 同步回声与触发时机（2026-09-26 三次拍板续，已落地）

§16 把**传输量**压下去了，但同步还有两块与数据量无关的浪费：一块是每次写入都会产生的**回声**，一块是**触发时机**决定的传播延迟。

### 17.1 回声：no-op 守卫只关掉了一半

`sync_once` 在**同一次循环里先 push 后 pull**，而 pull 的查询**不排除发起方自己**：

```sql
WHERE user_id = $1 AND server_revision > $2      -- 原先没有 device_id 条件
```

本设备这一轮 push 上去的 N 条，紧接着被自己原样拉回来，逐行走一遍 `apply_change`。

`sync_change_log` 其实**有 `device_id` 列**，服务端每个写入 handler 也都用 `set_config('app.current_device_id', $1, true)` 如实填了它 —— 数据齐备，只是 pull 没用上。

> **与 F8 的关系要说准**：no-op 守卫挡的是「重复推送在同一行上再产生一条日志」，**挡不住「首次推送产生的那条日志被自己拉回来」**。所以 §16 之后稳态（无写入）下行的确≈0，但**每次有写入的那一轮，必然跟着一轮等量的下行回声**。

**拍板**：pull 请求带上 `device_id`，服务端 SQL 加 `AND ($4::text IS NULL OR device_id IS NULL OR device_id <> $4)`。两个 `IS NULL` 分支都是必需的，删任一个都会出事：

| 子句 | 为什么不能省 |
| --- | --- |
| `device_id IS NULL` | **定时任务产生的变更没有设备身份**：`archive_purge` 不在请求上下文里跑，`app.current_device_id` 未设置，它发出的 DELETE 的 `device_id` 就是 NULL。这些删除**必须**送到每一台设备 —— 漏掉就会让客户端下次 push 把行复活（正是 §15 反复强调的那条）。该列存在之前的存量行同理 |
| `$4::text IS NULL` | 旧客户端不传这个字段 → 条件恒真 → 退化为原行为（全拉）。**两端可任意次序上线**，无需协调，也不需要旧客户端"先忍着" |

客户端在设备号为空（尚未注册的新装）时同样不发送该字段。

### 17.2 触发时机：本地写入最坏两个周期才跨设备可见

同步线程的循环是「同步一轮 → 睡」。醒来的条件只有两个：睡满 **30 分钟**（`spawn_periodic(_, 1800)` 的 `interval`），或者**上一轮拉到过数据**（那时改睡 **30 秒**，连续追几轮）。

问题在于后者**只作用于下行**：**上行的时机永远由本设备自己的定时器决定**。于是

> 手机记一条互动 → 手机等自己下一次醒来才上传（最坏 30 min）→ 电脑再等自己下一次醒来才拉到（最坏再来 30 min）→ **最坏 60 分钟**。

这跟传输量无关，纯粹是触发机制 —— 也解释了为什么"同步量明明降下来了，还是感觉慢"。此前同步只能从**设置页手动点**（`cloud_sync_now`），任何业务写入之后都不触发同步。

**拍板：写入后 debounce 触发。**

- **Rust**：`spawn_periodic` 的 `std::thread::sleep` 换成可被打断的 `wait_for_kick`（`std::sync::Condvar` + `bool` 标志）。刻意用 `std` 原语而非 `tokio::sync::Notify`：等待者是一个普通 `std::thread`（自带 runtime），拿不到 tokio 的通知器。新增 `sync::request_sync()`，调用可合并 —— 连发 N 次只唤醒一次。
- **命令**：`cloud_request_sync`，**只做唤醒、不同步执行**。⚠️ 若让前端直接跑 `cloud_sync_now`，它会与后台线程**抢同一个 SQLite 文件**，并可能把同一批行**重复推送**。
- **前端**：`createWebQueryClient()` 挂 `MutationCache.onSuccess` → debounce **2 秒** → `invoke('cloud_request_sync')`。**所有写入都经过 mutation，因此一处挂钩即覆盖全部调用点**，不会随着新 mutation 增加而漏掉。选 debounce 而非逐次触发，是因为批量操作（批量归档 / 导入）会连发几十个 mutation，逐个触发等于把刚省下的上行又还回去。浏览器模式（HTTP adapter 直连服务端、没有本地库）直接跳过。
- 失败一律静默：服务端不可达不代表写入失败，周期同步仍会兜住；把错误抛给调用方会让一次成功的保存看起来像坏了。

### 17.3 已评估但暂缓（非本次范围）

| 项 | 现状 | 影响 |
| --- | --- | --- |
| `prune_change_log` | 按 `changed_at` 删，而**该列没有任何索引**（现有索引是 `(user_id, server_revision)` / `(user_id, table_name, server_revision)`） | 每小时全表扫**全库最大的表** |
| `archive_purge` | `WHERE user_id=? AND ((archived_at IS NOT NULL AND archived_at<?) OR (deleted_at IS NOT NULL AND deleted_at<?))`；`note.archived_at` **无索引**、五张表的 `deleted_at` **全无索引**、`OR` 本身也易让索引失效 | 每 6 小时扫 5 张表 |
| `get_token` | 每轮先打一次 `api::manifest` 只为探活 token | 每轮多一次往返（可直接尝试、401 再刷新） |

> 用户判断：当前痛点（同步慢、归档被反复拉下来）已在 §15–§17 解决，索引属"量级尚未到瓶颈"的优化，留待数据量真正上来再做。

---

## 18. 第四轮 review：三个缺陷修复 + 墓碑写入审计（2026-09-26 已落地）

复查对象是 §15–§17 的**全部未提交改动**（20 个文件修改 / +2337 行）。找到 3 个会造成**静默失效**的缺陷并当场修复，另有 6 项记录在案待拍板。

### 18.1 已修复（F13–F17）

**F13 头像 / 附件删除的墓碑推不出去 —— 静默，最严重**

`commands/media.rs` 的 `delete_avatar`（:387）与 `delete_media`（:470）都只写 `deleted_at`，**不推进 `updated_at`**。

`media` 在 `UPDATED_AT_TABLES` 内，push 的过滤条件就是 `WHERE updated_at > <水位>`；墓碑的 `updated_at` 仍是上传时的旧值 → **永远选不中 → 头像删除永远不上行**，其它设备一直显示旧头像，且**两端都不报错**。

这正是 §16 反复强调的陷阱：把 `deleted_at` 加进 `push_columns("media")` 只让它**有能力**传输，`updated_at` 才是让它**有资格**被选中（`translate.rs` 当时的注释已经把这条因果写对了，只是漏了写入点）。

修法：两处改为 `SET deleted_at = ?1, updated_at = ?1`，并用 `business::lww_now()` 取代内联格式串。

**F14 `wait_for_kick` 会吞掉「同步进行中到达」的唤醒 —— F12 的一半价值失效**

`Condvar::wait_timeout` **不检查**已经设置的标志位。若 `request_sync()` 在同步线程**正跑一轮**时到达，`notify_one` 无人接收（通知丢失），但 `pending` 已置位；随后线程进入 `wait_for_kick` 仍会**睡满整个间隔**。

稳态（F11 回声过滤后 `pulled = 0`）的间隔是 **30 分钟**，不是 30 秒 —— 也就是说，恰好是"紧接着一次同步之后发生的写入"（最常见的一类）会退回原始的 30 分钟延迟，而 F12 要解决的正是这个。

修法：等待**前**先消费标志位。新增守卫测试 `wait_for_kick_consumes_a_kick_that_arrived_before_the_wait`（旧实现在该测试上会睡 30 s 并断言失败）。

**F15 SQLite 连接补 `busy_timeout` —— F12 把并发面放大了**

全仓**没有任何一处** `busy_timeout`（rusqlite 默认 0 ms）。WAL 只允许单写者，第二个写者**立即**拿到 `SQLITE_BUSY`（用户可见的 "database is locked"）。

磁盘上共有 4 个连接：主连接（`db.rs`）、周期同步线程、头像上传线程、`commands::sync::open_db`。F12 让「写入后约 2 秒起跑一轮同步」成为常态 → UI 写与同步写重叠从偶发变成常规。

修法：`db.rs` 新增 `CONN_PRAGMAS = "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"`，4 个连接点统一引用。

**F16 `push_columns("contact")` 漏 `archived_at` —— 联系人归档状态根本不参与同步**

`contact.archived_at` 在**两端都有列**（客户端 `migration.rs` 的 `archive_cols`；服务端迁移 `20260826000001`），但 `push_columns("contact")` 的列表里**从来没有它**。而 event / action / project / note 四个其它可归档类型都在各自列表里 —— `contact` 是唯一的例外。

后果是双重的：① 桌面端（若有入口）归档一个联系人，服务端**永远不知道**，服务端 UI 继续显示为活跃；② 服务端 `archive_purge` 的 contact 谓词**永远不成立** —— 它完全以 `archived_at` 为键，而没有任何一侧能把值送达。这不是"某个功能没做完"，而是**同一个字段在两端各自半死**。

修法：列表补 `archived_at`。**更重要的是把守卫测试补成通用的**：原来的 `push_columns_includes_archived_at` 只断言 `project` 一个 kind（这正是 `contact` 漏网的原因），已删除；改由 `column_lists_agree_with_real_schema` 对**真实迁移**断言"凡本地表有 `archived_at` 的 kind，其 `push_columns` 必须含该列"。

> ⚠️ 顺带暴露出一个**产品级空洞**（见 §18.4）：`contact` 的归档**没有任何入口** —— 服务端 `handlers/contact.rs` 完全不提 `archived_at`，web SPA 的 `Archive.tsx` 只认 `Action | Event | Project`，桌面端 `archive.rs` / `archive_sweep.rs` 同样只碰这三张表。所以 §15 拍的"contact 纳入清理"目前是**惰性条款**：列在、谓词在、清理逻辑在，但没有任何路径能把一个联系人置为已归档。F16 把同步链路补齐了，入口仍需单独立项。

**F17 `DELETE /api/settings` 会删掉用户的全部设置**

`handlers/setting.rs::delete` 执行的是 `DELETE FROM setting WHERE user_id = $1` —— **不按 key 限定**。而唯一的调用方（web adapter）发的是 `DELETE /api/settings?user_id=…&key=…`，**带了 key**。方法名、调用方、路由三者都指向"删一条"，实现却是"清空全部"。

目前无调用点，所以**尚未丢过数据**；但风险实打实：`setting` 表正是归档保留期覆盖（`archive_retention_days`）所在之处，将来一个"清掉我的主题偏好"就会把保留期**静默重置回默认值**，而那个值驱动的是**硬删**。

修法：按 `user_id + key` 限定删除；缺 `key` 返回 **400** 而不是"删全部"（此路由没有合理的批量清空用途，拒绝可恢复、清空不可恢复）。`user_id` 本来就只从 bearer token 取，查询串里的值一律忽略。

### 18.2 墓碑写入审计（本次建立的核对清单）
> **规则**：凡写 `deleted_at` 的语句，若该表在 `UPDATED_AT_TABLES` 内，**必须同时推进 `updated_at`**；否则墓碑永远落在水位之下 → **静默停同步**（不报错、不冲突、就是传不动）。

审计结果（修复后）：客户端 11 处写 `deleted_at` 的 UPDATE，**11/11 均带 `updated_at`** —— Action / Contact / Event / Event→Reminder 级联 / Interaction / Note / Project / Reminder / Tag / Media(×2)。

服务端**刻意不对称**：只有 `contact` / `project` / `event` / `action` 的 REST delete 同时写 `updated_at = now()`；`interaction`（:188）/ `reminder`（:182）/ `tag`（:158）只写 `deleted_at`。**这是可接受的，且不要"顺手补齐"**：服务端不按 `updated_at` 过滤，变更靠 change_log 传播；补了反而会让客户端离线期间对同一行的推送被判成 `server has newer updated_at`，产生冲突噪音。墓碑本身已由 upsert 的 `COALESCE(EXCLUDED.deleted_at, <table>.deleted_at)` 保护，复活不了。

### 18.3 二次拍板并落地（原"记录在案"六项）

以下六项在 §18 首轮报告后由用户一次性拍板全部落地。

| # | 项 | 落地内容 |
| --- | --- | --- |
| 1 | `ARCHIVED_AT_TABLES` 漏 `contact` | 已加 `contact`。逻辑：新设备不该先把已归档联系人拉下来，再由清理在 30 天后删掉 —— 真正的成本不是那一行，而是它背后 `contact → contact_tag / project_contact / reminder` 的级联。新增守卫测试 `archived_filter_tables_are_a_subset_of_purgeable_tables`，把"快照跳过的表"与"保留期会清的表"钉成子集关系（本轮正是这两张清单各自演化出了漂移） |
| 2 | `bootstrap_from_snapshot` 404 回退可致死循环 | 返回值由 `0` 哨兵改为 **`Option<i64>`**（`0` 本身是合法游标，调用方无法区分"从 0 开始"与"没有该端点"），`pull_all` 增加 `snapshot_unavailable` 闸门：一旦确认端点不存在，**剪枝恢复分支不再重试**，改为记一条明确的日志后继续读还能读到的变更日志。触发条件在正常部署下不可能（建表迁移与路由同版本上线），但故障形态是后台线程无限打服务端，值一个 bool |
| 3 | `archive_retention_days` 无写入方 | 澄清：**API 层本来就可达**（`POST /api/settings/upsert` 不设 key 白名单），缺的是 UI。本轮先补**安全边界**：新增纯函数 `effective_retention` + `MIN_RETENTION_DAYS = 7` 下限（`0`/负数仍 = 永久），解析失败回落默认值；生效时打日志（保留期驱动硬删，日志要能解释"为什么少了 40 行"）。守卫测试 `retention_override_is_floor_and_fallback_safe`。**UI 入口待单独立项** |
| 4 | junction 索引形状不匹配 | 新增迁移 **`20260926000004_snapshot_junction_indexes.sql`**：丢弃 `idx_contact_tag_user_live` / `idx_project_contact_user_live`（建在复合键上，能过滤不能供 `id` 序），改建 `(user_id, id) WHERE deleted_at IS NULL`，与 `snapshot` 的谓词逐字对齐。（不能改 `...000001`：迁移一旦被 sqlx 记录校验和，编辑它会让之后每次启动报 checksum mismatch） |
| 5 | 服务端 `now()` 与 `now_str()` 格式混用 | **10 处**全部改为 `now_str()`（action / contact / event ×2 / interaction / project / reminder / tag / media ×2，比首轮统计的 8 处多出 media 的 2 处）。理由写进代码注释：这些列是 TEXT，比较方式一律是字符串比较，而 `now()` 序列化成 `2026-09-26 13:37:06.123456+00`，同日会排在客户端 `...T...Z` 之下 → `archive_purge` **提前约 1 天**判过期。`tag.rs` / `interaction.rs` / `reminder.rs` 的过时注释（"该表没有 `updated_at`"）一并改写为"刻意不推进 `updated_at` 及其理由" |
| 6 | `push` 冲突分支不 `RELEASE SAVEPOINT` | 已补。`ROLLBACK TO` 会保留 savepoint 定义（可复用性正来源于此），不释放则一次请求内按冲突行数累积，最多 `PUSH_CHUNK_SIZE` 个 |

**额外发现（见 §18.1 的 F16 / F17）**：核查第 3 项可达性时，顺带查出 `push_columns("contact")` 漏 `archived_at`，以及 `DELETE /api/settings` 不按 key 限定会清空全部设置。两项均已修复。

### 18.4 遗留（本轮明确不做）

| 项 | 现状 | 说明 |
| --- | --- | --- |
| **contact 归档入口** | 列 / 快照过滤 / 清理谓词**三者齐备，独缺入口**：服务端 `handlers/contact.rs` 不提 `archived_at`，web `Archive.tsx` 只认 `Action \| Event \| Project`，桌面 `archive.rs` / `archive_sweep.rs` 同样只碰这三张表 | §15 的"contact 纳入清理"因此是**惰性条款**。要么补入口（三端 + `push_columns`，F16 已就绪），要么把 `contact` 移出 `PURGEABLE_TABLES` 以免误导。**待产品拍板** |
| 保留期 UI | 值可经 `POST /api/settings/upsert` 设置，两端均无界面 | 服务端安全边界（7 天下限 + 日志）已就位，可以安全地开 UI |
| 五个带 `archived_at` 的 kind 的快照索引 | `snapshot` 的谓词是 `(deleted_at IS NOT NULL OR archived_at IS NULL)`，与其 `(user_id, id) WHERE deleted_at IS NULL` 偏索引谓词不匹配 | 仍会退化为排序。与 §17.3 的索引族同批，等数据量真正上来再做 |
| `archive_purge` 的 `users_with_candidates` | 对 5 张表做 `EXISTS` 全表扫，`archived_at`/`deleted_at` 无索引 | 每 6 小时一次的后台任务，同 §17.3 处理 |

### 18.5 验证

- 客户端 `cargo test -p weavine --lib`：**67 passed / 5 failed**（5 个失败全部是 Windows 环境的既有失败：`data_dir` 走 `%APPDATA%` 而非测试沙箱 ×2，以及 3 个既有用例）。F14 的新守卫测试通过；`column_lists_agree_with_real_schema` 在加入 `archived_at` 通用断言后通过。
- `cargo test -p weavine-server --bins`：**36 passed / 5 failed**（基线 34/5，**+2 = 本轮两个新守卫测试全部通过**；5 个 failed 仍为本地测试库权限问题）。
- `cargo check -p weavine -p weavine-server` 通过（仅既有 warning）。
- 上线次序更新：迁移由 3 个变 **4 个**（新增 `20260926000004_snapshot_junction_indexes.sql`）→ 先跑迁移 → **服务端先发**（F17 改了 `DELETE /api/settings` 的契约：旧调用方本就带 `key`，无需客户端配合）→ 客户端后发。F13–F17 无新增列，双端可任意次序。


## 19. 第五轮 review：租户隔离（归属校验）审计（2026-09-27 已落地）

复查对象是一份外部 agent 报告点名的 5 处"缺 `user_id` 过滤"。**逐条核对后结论是：3 处成立、2 处是误报，而报告漏掉了同一族里危害最大的部分**——报告把 `create` 路径（`id` 是本次请求刚生成的 UUID，`WHERE id = $1` 只可能命中自己刚插入的行）和 `update` / `delete` 路径（`id` 来自 URL）混为一谈。真正的缺陷全部集中在后者。

### 19.1 缺陷族：只守第一条语句，次级写入不设防

共同形状：handler 的**主**语句写了 `AND user_id = $n`，命中 0 行时**不报错**、继续执行；于是所有**次级**写入（改关联、改派生字段、插日志行）照常落库，直到最后的响应查询才发现找不到行并返回 404 —— **写已经提交了**。所以它不报警、不回滚、不留痕，只有出现第二个用户才暴露。

| 编号 | 位置 | 类型 | 具体后果 |
| --- | --- | --- | --- |
| **F18** | `event::update` / `event::delete` **未调用 `authorize_event`**（同一文件里 `add_participant` / `set_participant_role` / `remove_participant` / `list_participants` 都调了，只有这两个 WebDAV 式 CRUD 漏了） | **跨用户写** | ① `UPDATE event SET contact_id=... WHERE id=$3`（无 `user_id`）→ 改他人事件的关联联系人，并推进 `updated_at` → 经 LWW 覆盖对方的设备；② `UPDATE reminder SET deleted_at=... WHERE event_id=$1`（无 `user_id`）→ **静默软删他人提醒**，墓碑写入 `sync_change_log` 后会同步到对方所有设备；③ `upsert_event_reminder` 按 `invitation_token` 查行 —— 该 token 是 `event:{id}:{lead}` 拼出来的，**不是秘密也不跨用户唯一**，配合 `SELECT id FROM reminder WHERE invitation_token=$1` / `UPDATE reminder ... WHERE id=$5` 可改写他人提醒行 |
| **F19** | `tag::update` 尾读 `SELECT ... FROM tag WHERE id = $1` 无 `user_id` | **跨用户读** | `UPDATE` 被 `user_id` 挡住（0 行），但响应查询不挡 → `PUT /api/tags/{他人 id}` 返回 **200 + 对方的 `name` / `color` / `created_at`**。**写是空操作、响应在泄露**，两者都不报错 |
| **F20** | `contact::create` / `contact::update` 插入 `contact_tag` 前不校验 tag 归属 | **跨用户挂载 + 信息泄露** | `contact_tag` 的约束是 `tag_id REFERENCES tag(id) ON DELETE CASCADE`，**`tag_id` 上没有用户维度**（`user_id` 只是冗余的归属列），所以请求体里的任意 `tag_id` 都能挂上。后果不止是一条脏数据：`contact::get` / `contact::list` 取标签的 JOIN 同样不带 `user_id` 谓词 → **对方的标签名与颜色会渲染进自己的联系人详情**；而且这行 junction 会带着 `user_id=自己 / tag_id=对方` 进入同步流，指向本机从未见过的 tag |
| **F21** | `log_requests`（**鉴权之前**的全局中间件，main.rs）+ `serve_file`（`/files/*key` 公开路由，无鉴权） | **日志放大** | 每个请求写一行 stderr，URI / key **原样**写入。请求行由 hyper 接收，上限是数百 KB → 一次请求换来等量磁盘写入，是匿名调用者少数能让服务端做的事之一 |

### 19.2 核查后**不成立**的 3 项（记录在案，避免重复上报）

| 报告条目 | 核查结果 |
| --- | --- |
| `tag.rs:79`（create 的尾读） | **不可利用**。`id` 是本次请求内 `Uuid::new_v4()` 刚生成的，`WHERE id = $1` 只可能命中这一行。仍补了 `user_id`，因为它是 update 尾读的复制模板，两处保持同形才不会漂移 |
| `event.rs:265 / 292`（create 内） | **不可利用**，理由同上（`create` 的 `id` 是刚生成的）。仍补了 `user_id`，让"handler 里没有不限定归属的写语句"成为可机械检查的性质 |
| `auth.rs:333` 错误日志未限流 | **该行不是日志**，是 `let keys = SERVICE_KEYS.get()...`。`auth.rs` 里唯一的每请求日志在 **:344**（`mismatched X-Service-Key`），而它只被 ocr / voice 调用，这两处**限流在鉴权之前** → 每 IP 每窗口有硬上限，刷不动。真正的无界日志是 F21 的位置 |
| "`event.rs` update 路径的 400 空 body 检查是否真在" | **不存在任何空 body 检查**，也不检查 `rows_affected`。`old` 读不到时用 `(None, "", None)` 兜底并**继续往下走** —— 这正是 F18 能成立的原因，而不是一个需要确认的边界 |

### 19.3 修法：把"依赖远处的门"改成"语句自限定"

`event` 的两个 handler 都加了 `authorize_event(&mut *tx, &id, &auth, true)`（`FOR UPDATE`，非本人 403、不存在/已删 404），但**没有停在这里**：一处门只能证明它之后**当前**的代码是安全的，而这一族 bug 连续三轮都是"有人加了一条新语句忘了它离门有多远"。所以每条次级语句也各自补上了 `user_id`：

- `event.rs`：`UPDATE event SET contact_id`（2 处）、`UPDATE reminder`、`DELETE FROM reminder`（2 处）、`upsert_event_reminder` 内部的 2 个 `SELECT` + 1 个 `UPDATE`、`sync_main_participant` 的 `SELECT` + `UPDATE`（**并给它加了 `user_id` 参数**，两个调用点都在鉴权之后，签名里带上它就不需要任何例外清单）。
- `tag.rs`：两处尾读。
- `contact.rs`：新增 `owned_tag_ids(executor, user_id, ids)` —— 一次 `SELECT id FROM tag WHERE user_id = $1 AND deleted_at IS NULL AND id = ANY($2)` 把请求体里的 tag 过滤成本人持有的，再插入；两处读标签的 JOIN 补 `AND t.user_id = ct.user_id`。**写法对齐 `project_contact::create`**（它本来就先校验两侧归属再插入，是这三轮里唯一没出问题的写入点）。
- `media.rs`：删除语句补 `user_id`（该处原本已有一道显式的 owner `SELECT` + 403，只是语句本身不自限定）。

**行为变更**：`PUT / DELETE /api/events/{他人 id}` 由「404 但已经把次级写入落库」变成「**403 且不写任何东西**」；`PUT /api/tags/{他人 id}` 由「200 + 对方数据」变成「404」。`/api/events/{不存在 id}` 仍是 404，只是不再落库。均为修正，无客户端需要配合。

### 19.4 新增守卫测试（两条，纯文本扫描，不需要数据库）

`handlers/mod.rs` 里加了源码扫描型守卫 —— 这一族已经连续三轮产出缺陷，而每次都是**同一种形状**，值得用机器钉住：

1. `writes_to_owned_tables_name_user_id`：handler 层每一条 `UPDATE` / `DELETE FROM` 必须出现 `user_id`，否则报出语句原文。例外走 `SCOPE_EXEMPT`（**必须写理由**，键为「文件名 + 语句片段」）：`activation`（`install_id` 本身即匿名设备凭证）、`auth` × 4（`devices` 的 id 来自待刷新的 access token；`refresh_token` 按 `token_hash` 限定，token 即凭证；`user_account` / `password_reset_token` 的 id 来自已消费的 reset token）、`sync`（`sync_change_log` 是服务端内部复制日志，不是用户内容）。
2. `reads_by_primary_key_name_user_id`：`SELECT ... WHERE id = $n` 形式的按主键查询同样必须出现 `user_id`（F19 就是这一类）。例外 2 条，均为"id 来自已消费的令牌"。
3. 两条测试都带**下界断言**（写语句 ≥ 40、按主键读 ≥ 5）：扫描器一旦失效就会立刻失败，而不是"扫到 0 条、全部通过"地假绿。

诚实标注：扫描的是**写下来的 SQL 文本**，`format!` 拼出来的语句只能检查其字面部分（插值进去的只有表名/列名，不含值）；它也不覆盖"读"的其他形态（非主键谓词）——那部分仍靠各 kind 的查询模板约束。

另加 `log_truncation_clamps_and_stays_on_char_boundaries`：请求日志按 256 字符截断，且必须切在 char 边界上（`中` 是 3 字节，切 7 会退到 6）。

### 19.5 验证

- `cargo test -p weavine-server --bins`：**39 passed / 5 failed**（基线 36/5，**+3 = 本轮三个新测试全部通过**；5 个 failed 仍是本地测试库权限问题，与本轮无关）。
- `cargo check -p weavine -p weavine-server` 通过（仅既有 warning）。
- 全仓复核：扫描器对 `server/src/handlers/*.rs` 的复核结果只剩 7 条 `SCOPE_EXEMPT` 命中的语句，读侧只剩 2 条 `READ_SCOPE_EXEMPT` 命中 —— **没有任何未登记的例外**。
- **不需要新迁移、不涉及客户端**：纯服务端改写 + 一处日志截断，与既有上线次序（先跑 4 个迁移 → 服务端先发 → 客户端后发）无耦合，可单独发。


