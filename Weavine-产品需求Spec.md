# Weavine 产品蓝图（Product Blueprint / Spec）

> 版本：**v1.2（产品蓝图合并版）** ｜ 整理日期：2026-08-07 ｜ 最近更新：**2026-08-17 — v1.0.9 P0 修复 sweep**：(1) **P0-a 同步游标饿死** —— `commands/media.rs` `updated_at` 空格格式 `%Y-%m-%d %H:%M:%S` 与全栈 Z 格式 `%Y-%m-%dT%H:%M:%S%.3fZ` 混用 → 全局游标 `KEY_LAST_PUSHED_AT` 一旦推到 Z 行,后续空格格式 media 行 string-cmp 永远 `<` 游标,media 永不重推。已统一为 Z 格式。(2) **P0-b 桌面 avatar write-back** —— `upload_avatar`/`delete_avatar` 不更新 `Contact.avatar_storage_key`(服务端有 trigger 镜像,桌面无),已加手动写回镜像 `Contact` 行 + 修复 `get_avatar` 路径 user_id 双 join bug。(3) **桌面头像/名片图渲染** —— `register_uri_scheme_protocol("files")` 接管 `files://localhost/files/{key}` 请求,从 `data_dir()` 服务;`TauriAdapter.baseUrl='files://localhost'` 让所有 `avatarUrlFor`/`cardImageUrl` 命中协议。(4) **server `now_str()` Z 统一** —— `handlers/mod.rs:32` 改为 Z 格式,server↔client LWW 比较一致;`archive_sweep`/`archive`/`cadence_server`/`activation` 的 `DateTime::parse_from_rfc3339` 不再因 server 写空格失败。(5) **QuickCapture 静默失败** —— `submit()` `if (!userId) return;` 改为显式 `setError('本地用户尚未就绪')`,E2E quick-capture ×3 全绿。(6) **ContactDetail avatar 错误透出** —— `err instanceof Error ? err.message : String(err)`,Tauri v2 invoke 拒绝时返 raw Rust string 不再吞成通用文案。(7) **Re-OCR 入口从 ContactDetail 移到 ContactEdit** —— 扫描结果填入表单由用户确认(§7 Q9 拍板 2026-08-17)。**§11.5.6 Q4 部分启用**:FREE quota 20→100/天,TRIAL 50,PRO 不限,仅匿名 device_key 路径生效。**状态:v1.0.9 已发布(tag v1.0.9,commit e38762f,2026-08-17,Phase 2.7 bugfix sweep 全部落地);P2/P3 与 #16–#20 待排期** **2026-08-18 增补 (8)(9)**:(8) **Windows/Android 头像不显示(裁剪正常但最终不换)** —— Tauri v2 自定义协议跨平台映射不同:macOS/Linux=`files://localhost/<path>`,Windows(WebView2)/Android(WebView)=`http://files.localhost/<path>`;v1.0.9 的 `TauriAdapter.baseUrl='files://localhost'` 仅在 macOS/Linux 生效,Windows/Android 上 `<img>` 加载失败回退首字母。已改 `filesBaseUrl()` 按 UA 区分。(9) **Android 麦克风授权后仍报无权限** —— `AndroidManifest.xml` 只声明 INTERNET,`RustWebChromeClient.onPermissionRequest` 的 RECORD_AUDIO 运行时请求被系统自动拒绝(部分 OEM 仍弹窗但回调 denied);已在 manifest 补 `RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS`/`CAMERA`。**注意:`src-tauri/gen/` 在 .gitignore 中,manifest 修改不入 git,重克隆后需 `tauri android init` 重新补权限(建议把权限清单记入部署文档)** **2026-08-18 增补 (10) Android 录音"说话没反应"**:`voice.ts` `recordAudio` 的"warm-up"实现把 `stream.getTracks().forEach(t => t.stop())` 立即关掉了所有音频轨道,返回的是**已停止的 stream** → `MediaRecorder` 拿到死流 → `ondataavailable` 不出数据 → onstop 产出空 blob → 服务端 400 "empty audio"(被 `.catch(fail)` 吞成 setError,用户感知为"没反应")。已改为**延迟 200ms 再 `recorder.start()`**(正确 warm-up,不动 track),并对 `new MediaRecorder` 包 try/catch 让"NotSupported"等错误透出而非被通用文案吞掉。**残留风险**:Android System WebView 的 MediaRecorder 对纯音频流支持有限,若修复后仍产空 blob/NotSupportedError,则需按 §3.5/§7 拍板改用 Android 原生 SpeechRecognizer 插件(当前代码违背该拍板,走的是 MediaRecorder+云端 whisper)。
> **最近更新（2026-08-26 增补 / 2026-08-27 落地）**：新增 §11.7「md 文件编辑器 + 显式『导入库』架构定稿」——**Windows / Linux / macOS 三桌面版**打开本地 `.md` 仅作纯编辑器（保存只写文件、不写库、不参与云端同步）；仅「导入库」显式桥接进 `Note` 表 + `EntityLink` 体系（可关联联系人/待办/日程、随库同步、记来源路径+时间，**`imported_from` 路径不上云**——服务端 drop 防泄露）；库笔记可导出 `.md`；三平台安装注册 `.md` 默认打开程序（Windows WiX / macOS `Info.plist` UTI / Linux `.desktop` MimeType）+ `tauri-plugin-single-instance` 处理冷启动 argv，作为扩大使用范围、提高打开频次与粘性的顶级分发入口。补充：re-import 弹选择框、UTF-8/GBK 自动嗅探、>1 MB 禁入库但仍可本地编辑、最近文件列表（LRU 10）、编辑器 MVP 范围（不做协同/AI/Vim）。**2026-08-27 实现落地**：commit `f04d944` 主干。新增 `src-tauri/src/md_editor.rs`（12 个 tauri command：`read_md_file`/`write_md_file`/`open_md_dialog`/`save_md_dialog`/`md_get_recent_files`/`md_add_recent_file`/`md_clear_recent_files`/`md_check_import_status`/`md_import_to_library`/`md_export_note_as_md`/`md_get_file_info`），`apps/web-spa/src/routes/MdEditor.tsx` 路由（分屏编辑/预览切换、`Ctrl+S` 保存、>1 MB 顶部 banner、`导入库` 按钮），`AppShell` 菜单项 `📝 编辑 .md`，`NoteDetail` 增加 `导出 .md` 按钮（导出时 `setFileTimes` 把文件 mtime 设为 `imported_at` 让重导入走快速路径），`App.tsx` 监听 `open-md-from-argv` 事件接收 OS 文件关联的冷启动 argv。新增需求 #40。

> **产品蓝图（唯一权威）**：本文档是 Weavine 的**唯一产品蓝图**。所有需求设计、状态调整、平台策略、中国特性、技术债均回写此处，不再创建独立 spec 文件。文档结构一旦建立保持稳定，后续只追加章节、不重排结构。
> **维护约定（living spec）**：本文档为活文档。每次需求变动须回写本节并更新上方「最近更新」日期；对应的 weavine 子待办统一挂在项目 `Weavine`（`a119f2d7-4b87-4ce9-ac4b-015ab75ea257`）下，与 spec 编号（#1–#20）一一对应，便于持续跟踪。
> **拍板溯源**：§3.5 子系统设计的所有关键决策（解析引擎选型、节奏模型、范围、Android 验证方式）来源于 2026-08-09 brainstorming 会话，详见各小节顶部加粗的「拍板结论」标注。
> 合并来源：
>
> - 《Weavine 产品优化需求文档》（2026-08-06，产品规划视角，12 项需求 + 优先级）
> - 《Weavine 代码审查报告》（2026-08-06，代码现实视角，架构 + 同步根因 + 偏差）
>   代码路径：`/home/yf/workspace/opencode/weavine`（WSL，与 MarketAI 同目录）
>   **2026-08-09 合并说明**：本文档（工作区维护版）与项目根目录 `Weavine-产品需求Spec.md`（8/9 15:07）已对齐统一。项目根目录版原标「✅ 全部落地」，经代码复核（git HEAD `912c7d4`，含 8/9 下午 `f16fe2a` #4 图谱 / `7491e1d` #3 事件多人 UI / `d0fa495`·`912c7d4` #1 头像 / `d9c6e1e` #5 / `7a9bafa` #12 F6 等提交）确认该判断基本成立；项目根目录版漏记的 §5.7 同步白名单断链（P0）已标注并于 2026-08-09 修复闭环。

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

### 2.3 同步 —— F1–F6 已落地，§5.7 白名单断链已修复（见 §4 专项 / §5.7）

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

### 3.5.1 架构（单子系统、跨端复用）

```
┌─────────────────────────────────────────────────────┐
│  UI 层                                              │
│  Web:   <QuickCapture/>  React + 全局快捷键 hook    │
│  Desk:  同上, Tauri globalShortcut (系统级 Ctrl+K)   │
│  Andr:  浮动 FAB + sherpa-onnx 端上 ASR            │
└─────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  解析层 (Rust, 共享)                                 │
│  weavine_lib::quick::parse(text) → QuickItem       │
│   - chrono 解析时间                                  │
│   - 字串匹配联系人 (已有索引 + 模糊)                   │
│   - 关键词分类 (日程/待办/互动)                        │
│   - 置信度评分 + 缺失字段标记                         │
└─────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  写入层                                             │
│  Desktop/Tauri: business::event/action/interaction │
│  Web:            POST /api/events/actions/inter... │
│  共用同一个 adapter（已有的 sync/translate 路径）      │
└─────────────────────────────────────────────────────┘

#14 节奏（独立线程）:
┌─────────────────────────────────────────────────────┐
│  Cadence Tick (每天 0:00 + 每小时检查)              │
│   - 查 contact.importance + last_interaction_at    │
│   - 满足阈值 → 创建 reminder (kind = Cadence)       │
│   - 复用已有 reminder 系统 (同步/通知/音效)           │
└─────────────────────────────────────────────────────┘
```

### 3.5.2 数据模型变更

**Contact 表新增 1 列**（`weavine_lib::models::Contact`）：

```rust
pub last_interaction_at: Option<String>,  // ISO8601, nullable
```

**Contact.importance 统一**（**2026-08-09 清理·拍板 ✅**）：

| 档位 | 字符串 | 节奏阈值 | 默认 |
|------|--------|----------|------|
| 高 | `high` | 14 天 | — |
| 中 | `medium` | 45 天 | — |
| 低 | `low` | 不提醒 | ✅ 默认 |

- **三档语义固定**（`low`/`medium`/`high`），UI 选项与 schema 一致；**默认值改为 `low`**。
- **历史 `normal` 数据迁移**为 `medium`（数据迁移 + 业务层兼容）。
- **DB / 业务层 / server handler 默认值统一为 `low`**。Server handler 之前在 JSON 缺 `importance` 时硬塞 `'medium'` 的 bug **修复为跟随 DB 默认 `low`**，避免数据漂移。
- **删 `ContactsList.tsx:67` 的 `'normal'` 过滤常量**（与 UI 三档不一致的死代码）。
- **Onboarding 强制提示**用户给首批联系人打 importance 标签——避免"节奏提醒从未触发"的体验问题（低档默认 = 不提醒）。

**删除死字段 `reminder_enabled` 与 `reminder_interval_days`**（**2026-08-09 拍板 ✅**）：

- 调研结论：业务层 0 处使用、UI 0 处读写、SQL 0 处引用；只在 `cloud_sync.rs:239/244` 测试断言里出现。
- 真正的"自动提醒"从未实现，被本节 §3.5 的 Cadence 中枢取代，**删除安全**。
- **影响范围**：双栈 schema + business + sync + handler + types + 2 处测试断言（需改为不依赖已删除字段）。
- 无用户可见行为变化。

**Interaction 触发器**：在 `business::interaction::create()` 之后，附加 `UPDATE contact SET last_interaction_at = ?1 WHERE id = ?2`（`?1 = interaction.occurred_at`，**不是 `NOW()`**）。补记互动时（"上周和 KK 林吃饭"），`last_interaction_at` 必须回到当时而非今天，否则 cadence 阈值被无意义刷新、节奏语义失真。**同一事务内**，保证 cadence 计算一致。

**Reminder 复用**，加 1 个枚举变体：

```rust
pub enum ReminderKind { Time, Cadence }
```

- `Time` = 已有（用户手设的）
- `Cadence` = 系统自动生成（#14）

`Importance` 枚举重写（`weavine_lib::models::Importance`）：

```rust
pub enum Importance { Low, Medium, High }
// 序列化：Low -> "low", Medium -> "medium", High -> "high"
// 与 SQLite/PG TEXT 列直接兼容；不允许其它字符串。
```

### 3.5.3 本地解析规则（确定性，无 LLM）

```rust
// weavine_lib::quick
pub fn parse(input: &str, contacts: &[Contact]) -> QuickItem {
    let now = Local::now();
    let (kind, kind_score) = classify_kind(input);     // 关键词表
    let due = chrono_parse(input, now);                // chrono 中文 + 英文
    let contact = match_contact(input, contacts);      // 子串 + 别名 + 拼音简写
    let confidence = compute_confidence(due, contact, kind_score);
    QuickItem { kind, due, contact_id, summary, raw: input, confidence }
}

fn classify_kind(s: &str) -> (Kind, f32) {
    if contains_any(s, &["开会","见","约","meeting","meet"]) -> (Event, 0.9)
    else if contains_any(s, &["待办","记得","要","todo"]) -> (Action, 0.9)
    else if contains_any(s, &["吃饭","通话","聊","call","dinner"]) -> (Interaction, 0.85)
    else -> (Action, 0.6)  // 默认待办
}
```

**规则覆盖**（Chinese + English）：

- **时间**：chrono 中文支持 + 英文（"tomorrow", "next monday", "下周三", "下个月15号"）
- **联系人**：已存联系人的姓名 / 别名 / 拼音简写 / 手机号尾号
- **关键词**：手维护 kind 关键词表（各 20+ 词），后续按误判反馈调整

**解析失败的兜底**：永远创建一个 Action（待办），raw 文本作为 summary，联系人/时间字段为 null，UI 显示"未识别时间 / 未匹配联系人，点击补全"。

### 3.5.4 UI 设计

**Web/Desktop**（共用 React 组件）：

- Ctrl+K 触发（Desktop 走 `tauri-plugin-global-shortcut` 注册系统级快捷键，Web 走 `useEffect` 监听 keydown）
- 三个 Tab（Tab 键切换）：日程 / 待办 / 互动
- 输入框 + **实时解析预览**（下方 1 行显示 `→ 周三 14:00，联系人: 李雷`）
- 联系人下拉（实时匹配）
- `Enter` 创建，`Esc` 关闭

**Android**（浮动 FAB）：

- 全屏面板（同上），底部多一个麦克风按钮
- **长按麦克风** → 录音 → 转文字（**sherpa-onnx 端上 ASR**，Rust command `recognize_voice_local`；非 Web Speech API，因 Android WebView 国内连不上 Google，详见 §11.6）→ 自动填入输入框

> **v1.0.9 UX 变更**：名片扫描 / 重新拍名片入口从 `ContactDetail`（只读查看页）移到 `ContactEdit`（编辑页）。理由：扫描结果是草稿，须用户确认入库（详见 §7 Q9 拍板）。`ContactDetail` 顶部 `📷 重新拍名片` 按钮 v1.0.9 移除。QuickCapture 提交逻辑 v1.0.9 修复：`submit()` 在 `userId` 尚未加载时由静默 return 改为显式错误 `setError('本地用户尚未就绪')`。

### 3.5.5 #14 节奏触发

**拍板**：高(亲密)= 14 天，中(重要)= 45 天，低(普通)= 不提醒。**owner = 端上 first-party（B2）** —— 桌面/Android 各自 SQLite 算本地、Server 算为 Web。同一 `CadenceEngine` trait 抽象，两套实现（sqlx::PgPool + rusqlite::Connection）。

```rust
// weavine_lib::cadence (新模块,共享 trait + 数据结构)
// src-tauri/src/business/cadence.rs (桌面/Android: rusqlite 实现)
// server/src/handlers/cadence.rs (Server: sqlx 实现)

pub trait CadenceEngine {
    fn stale_contacts(&self, importance: Importance, cutoff: DateTime<Utc>) -> Result<Vec<Contact>>;
    fn existing_cadence_reminder(&self, contact_id: &str) -> Result<Option<Reminder>>;
    fn create_cadence_reminder(&self, contact_id: &str, now: DateTime<Utc>, invitation_token: &str) -> Result<Reminder>;
}

// Desktop/Android 用 rusqlite::Connection 实现
pub struct LocalCadenceEngine<'a> { pub conn: &'a rusqlite::Connection }

// Server 用 sqlx::PgPool 实现
pub struct ServerCadenceEngine<'a> { pub pool: &'a sqlx::PgPool }

const CADENCE_THRESHOLDS: &[(Importance, i64)] = &[
    (Importance::High, 14),    // 高(亲密)
    (Importance::Medium, 45),  // 中(重要)
];
// Importance::Low 不在循环中 — 显式不提醒（避免淹没）；低档为新建联系人默认。

pub async fn tick_cadence<E: CadenceEngine>(now: DateTime<Utc>, engine: &E) -> Result<()> {
    for (importance, days) in CADENCE_THRESHOLDS {
        let cutoff = now - Duration::days(*days);
        for c in engine.stale_contacts(*importance, cutoff)? {
            if engine.existing_cadence_reminder(&c.id)?.is_some() { continue; }
            // invitation_token = "{user_id}:{contact_id}:{threshold_day}"(确定性生成,跨端等价)
            let token = format!("{}:{}:{}", c.user_id, c.id, days);
            engine.create_cadence_reminder(&c.id, now, &token)?;
        }
    }
    Ok(())
}
```

**调度**：

- **Desktop**：启动时启动 tokio task，每 1 小时跑一次（rusqlite 实现）
- **Android**：同 Desktop（Tauri Android runtime，rusqlite 连接本地 SQLite）
- **Server**：cron job，每 1 小时跑一次（sqlx 实现）—— 为 Web 端计算

**取消 / 暂停规则**：

- 用户在联系人详情页点 [知道了] → 删除该 cadence reminder + 7 天内不重弹
- 用户在联系人详情页设置"暂停提醒 N 天" → 跳过

### 3.5.6 多端同步策略

走已有的 sync 通道：

- 新增 sync kind: `cadence_reminder`（沿用 reminder 表，通过 `ReminderKind` 区分）
- `contact.last_interaction_at` 列同步（已有 contact sync 路径，只需更新 `push_columns`）
- reminder sync 已实现 ✅（#12 已闭环）

**B2 跨端去重 —— invitation token 协议**：

```
invitation_token = "{user_id}:{contact_id}:{threshold_day}"  // 确定性生成
```

- **桌面/Android 各自算**：用户 A 在桌面 A1 计算 cadence → 创建 reminder，token = `A:contact-123:14`
- **桌面 A2 同步拉到这条 reminder**：reminder 的 `invitation_token` 跨端等价
- **桌面 A2 自己也跑 cadence**：看到 `existing_cadence_reminder` 已存在（token 命中）→ 跳过
- **Server 为 Web 算**：同样基于 token 幂等性 → 不会产生重复 reminder

**Reminders 表新增 1 列**：`invitation_token TEXT NULL`（cadence 类 reminder 必填；time 类 reminder 为 NULL）。两端 reminder 通过 token 唯一性自动协调，无中心化去重服务。

> invitation_token 是 B2 拍板引入的核心协议 —— 不依赖中心协调表，靠内容寻址（content addressing）天然去重。

### 3.5.7 测试策略

**单元测试**（`weavine_lib`）：

- `quick::parse` 各场景：中/英 时间 + 联系人 + 类型，覆盖 30+ 用例
- `cadence::tick` 边界：亲密过期 → 创建 reminder / 重要过期 → 创建 reminder / **普通档不参与(显式跳过)** / 无交互历史(close 联系人为全新 → 直接提醒) / invitation_token 幂等(同 contact 二次 tick 不创建重复 reminder)

**E2E**（Playwright）：

- Web Ctrl+K → 输入 → 解析预览 → 创建日程 → 验证日历显示
- 桌面麦克风（E2E 不能测，手动验证）
- **v1.0.9 加固**：QuickCapture `submit()` 在 `userId` 尚未就绪时不再静默返回，改为 `setError('本地用户尚未就绪')`，覆盖 `quick-capture.spec.mts` ×3 全绿。

**Android**（模拟器）：

- 启动 APK → 浮动按钮 → 文本输入 → 创建
- 长按麦克风 → 录音（可放音频测试）→ 转文字 → 创建

### 3.5.8 实施步骤（约 8 人/日）

| #   | 任务                                       | 估算    | 备注                                                         |
| --- | ---------------------------------------- | ----- | ---------------------------------------------------------- |
| 1   | 数据模型：Contact.last_interaction_at + ReminderKind enum + migration | 0.5 d | 桌面 + server 双 migration                                    |
| 2   | 本地解析引擎 `weavine_lib::quick` + 30+ 单测        | 1 d   | 关键词表与 chrono 中文支持                                            |
| 3   | Web Ctrl+K 面板：React 组件 + 键盘 hook + 解析预览      | 1 d   | 与现有 SearchablePicker 复用                                    |
| 4   | Desktop 全局快捷键：tauri-plugin-global-shortcut       | 0.5 d | 注册 Ctrl+K                                                  |
| 5   | Android FAB + 语音：浮动按钮 + Tauri 原生 plugin         | 1 d   | `tauri-plugin-android-speechrecognition` + RECORD_AUDIO 权限 |
| 6   | 桌面麦克风：Web Speech API（同 Android）                  | 0.5 d |                                                              |
| 7   | #14 节奏引擎：CadenceEngine trait + 桌面/Android rusqlite 实现 + Server sqlx 实现 + invitation_token | 1.5 d | B2 拍板多套实现 + 跨端去重协议                                |
| 8   | 跨端同步：cadence_reminder kind + contact 列同步        | 0.5 d | §5.7 修复已通，路径现成                                            |
| 9   | E2E + 模拟器验证                                 | 1 d   | Playwright web + Android emulator APK                       |
| 10  | Spec 文档更新（本文档对应章节）+ commit                  | 0.5 d | 本次 spec 编辑完成后即对应该项                                         |

### 3.5.9 不在范围（明确）

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

### 3.6.1 架构（v1.0.4 — Rust scheduler 取代客户端轮询）

```
[事件 INSERT/UPDATE（reminder_lead_minutes>0）]
        ↓ client-side hook（同一调用栈，sync_event_reminder）
[reminder INSERT kind='time' event_id=... trigger_at=start_at-lead invitation_token=event:{id}:{lead}]
        ↓
[schedule_for_reminder(Rust)]
  ├─ spawn sleep(trigger_at - now - 5s)
  ├─ 到点：claim_due_reminders()  →  标 dispatched=true
  ├─ tauri-plugin-notification.show()  →  OS NotificationManager / WinRT / libnotify / NSUserNotification
  └─ emit("weavine:reminder-fired", r)  →  JS dispatch CustomEvent('weavine:reminder')
                                            →  App.tsx 显示 in-app banner

[启动时 startup_catch_up]
  list_pending() → 对每条 reminder 重新 schedule_for_reminder
  (覆盖"OS 杀进程→sleep 中断→漏发"场景)

[Web SPA standalone / 浏览器直接打开]
  use-reminder-poller setInterval(tick, 30s) + Web Notification API
  (Rust runtime 不存在，保留 v1.0.3 老路径)

[任一端用户点击/dismiss]
POST /api/reminders/:id/dismiss → server 按 invitation_token 同 token 全部置 dismissed=true
                                    ↓
                            下次 list() 自动排除 dismissed=true
```

**为什么不再轮询**（v1.0.4 决策依据）：
- 30s 轮询每秒醒一次 CPU，Android 上耗电；且 poller 和 Rust sleep 任务可能双发（Rust 已 mark dispatched，但 poller 因 race condition 没看到，导致同一 reminder 弹两次）。
- Rust `tokio::sleep` 在睡眠期是 0 持续开销，OS 调度器只在 trigger_at 唤醒，到点精度 ±5s。
- 用户改 reminder_lead_minutes → `sync_event_reminder` DELETE 旧 + INSERT 新 → schedule 新任务；旧 sleep 任务在 trigger_at 醒来调 `claim_due_reminders`，**因为行已被 DELETE**，自然不重复发。

### 3.6.2 数据模型（无新表，复用 reminder）

```sql
-- reminder 表当前结构（已存在，无需 migration）
id              text PK
user_id         text NOT NULL FK
contact_id      text NULL FK
event_id        text NULL FK        ← 事件派生用此字段
trigger_at      text NOT NULL       ← ISO8601 UTC（"2026-08-11T15:00:00Z"）
kind            text NOT NULL       ← CHECK ('time'|'cadence')  事件派生用 'time'
dispatched      boolean DEFAULT false
dismissed       boolean DEFAULT false
invitation_token text NULL           ← 内容寻址: 'event:{event_id}:{lead_minutes}'
created_at      text NOT NULL
server_revision bigint
deleted_at      text NULL

-- 索引已就位:
--   idx_reminder_owner_trigger(user_id, trigger_at, dispatched, dismissed)
--   idx_reminder_invitation_token(invitation_token) WHERE invitation_token IS NOT NULL
```

### 3.6.3 服务端实现（v1.0.4 — 派生从 server 移到 client）

**A. 事件 reminder 派生（`src-tauri/src/business/reminder.rs::sync_event_reminder`）**

`commands::event::create_event` / `update_event` 同调用栈内追加：

| 情况 | 派生动作 |
|---|---|
| INSERT `reminder_lead_minutes > 0` + `start_at` 存在 | INSERT reminder: kind='time', event_id, trigger_at=start_at-lead, invitation_token=`event:{event_id}:{lead}` |
| UPDATE `reminder_lead_minutes`/`start_at` 变化 | DELETE 旧 reminder (kind='time', event_id=...) 后 INSERT 新；lead=0 或 NULL 时只 DELETE |
| 事件 DELETE/archived | DELETE 同 token 的 reminder（cascade 由 FK 接管） |

**B. 客户端 dispatcher（`src-tauri/src/commands/notification.rs`）**

```rust
pub fn schedule_for_reminder(app: &AppHandle, r: &Reminder)        // 公开 API
pub fn schedule_notification(app: AppHandle, args: ScheduleArgs)   // #[tauri::command]
pub fn startup_catch_up(app: &AppHandle, db: &Database)             // setup() 调用
fn fire(app: &AppHandle, title: &str, body: &str) -> Result<(), String>  // OS API 封装
```

`schedule_notification` 流程：
1. 计算 `delay = trigger_at - now`，如果 `delay > 5s`：`tokio::sleep(delay - 5s)`
2. 醒来调 `business::reminder::claim_due_reminders(&conn)`：SELECT 所有 `dispatched=false AND dismissed=false AND trigger_at <= now()`，批量标 `dispatched=true`。**这一步同时回收旧 sleep 任务"过期但还没标 dispatched"的行**。
3. 对每条 reminder 调 `app.notification().builder().title().body().show()` → 系统 API
4. `app.emit("weavine:reminder-fired", &r)` → JS CustomEvent → in-app banner

**C. Server-side dispatcher（`server/src/reminder_dispatcher.rs` — 仍保留作为兜底）**

v1.0.4 起 client 是主路径，server 端 dispatcher 只在"多端共享 reminder 状态需要 server 知道哪些已 dispatched"场景下作用：

```rust
const REMINDER_DISPATCH_INTERVAL_SECS: u64 = 60;
pub async fn tick_reminder_dispatch_async(now: DateTime<Utc>, pool: &PgPool) -> Result<usize>;
pub fn spawn_reminder_dispatcher(pool: Arc<PgPool>);
```

每 60s：把过期 reminder 标 `dispatched=true`（防止 server 端累积未清理项）。客户端不依赖这条路径——纯 server 端 hygiene。

`server/src/main.rs:56` 在 `spawn_cadence_scheduler(pool.clone())` 旁边追加一行。

### 3.6.4 三端原生通道（v1.0.4）

| 端 | 触发路径 | 系统 API | 实施组件 |
|---|---|---|---|
| **Web SPA (Tauri 包装)** | Rust `schedule_for_reminder` → sleep → `tauri-plugin-notification` | macOS UNUserNotificationCenter / Windows Toast XML / Linux libnotify / Android NotificationManager | 已有：`tauri-plugin-notification = "2"`（default `tauri` feature）+ `lib.rs` `.plugin(...)` + `capabilities/default.json` 加 `"notification:default"` |
| **Web SPA (浏览器 standalone)** | `use-reminder-poller.ts` `isTauri()=false` 分支 → setInterval(30s) → `Notification` API + in-app toast | W3C Notification API | 已有：`lib/notifications.ts` + `lib/use-reminder-poller.ts` |
| **Desktop Tauri (mac/Win/Linux)** | 同 Web Tauri 路径 | macOS UNUserNotificationCenter / Windows Toast XML / Linux libnotify | 同 Web Tauri |
| **Android Tauri APK** | 同 Web Tauri 路径 | NotificationManager + channel（`high_importance_reminders`）+ 运行时 POST_NOTIFICATIONS 申请（Android 13+） | 已有：`AndroidManifest.xml` 加 `POST_NOTIFICATIONS` + `SCHEDULE_EXACT_ALARM` 权限；Tauri capability 已授权 |
| **iOS** | ❌ 不在范围（D4 = A；等 #10 远期） | — | — |

### 3.6.5 跨端去重（D2 落地）

任一端 dismiss 时：

```http
POST /api/reminders/:id/dismiss
→ server: UPDATE reminder SET dismissed=true WHERE invitation_token=$1 AND dismissed=false
```

回值 200 即所有同 token 的 reminder 在三端下次轮询时不再出现。

### 3.6.6 时区与精度（D3 落地）

- store: `trigger_at = (start_at - lead_minutes).to_rfc3339()`（UTC）
- render: `new Date(trigger_at).toLocaleString('zh-CN', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })`
- 用户跨国/改时区：旧 reminder 显示可能偏移（不主动重算，符合"一次性事件，不补提醒"原则）

### 3.6.7 测试策略

**Unit（Rust）**：
- `server/src/handlers/event.rs`：INSERT 事件 + reminder_lead_minutes=15 → 1 reminder 派生（assert trigger_at = start_at - 15min, kind='time', invitation_token 格式正确）
- UPDATE lead 从 15→30 → 同 token reminder 更新（dispatched=false 不变）
- UPDATE lead=0 → 同 token reminder 被删除
- DELETE 事件 → reminder cascade 消失
- `reminder_dispatcher::tick`：seed 2 reminder（一到期一未来）→ assert 过期那个 `dispatched=true`，未来的不动

**E2E（Playwright）**：
- 注册 → 创建事件 (start_at = now+2min, reminder_lead_minutes=1) → 等 90s → 轮询 reminder API → assert 新 reminder 已生成 + dispatched=true（dispatcher 兜底）

**桌面/手动**：
- Desktop: 创建事件 start_at = now+90s → 桌面右上角出现系统通知 → 点击聚焦窗口
- Android: 模拟器同桌面（emulator 推送限制需 adb 调试桥）

### 3.6.8 实施步骤（约 3 人/日）

| #   | 任务                                       | 估算    | 备注                                                         |
| --- | ---------------------------------------- | ----- | ---------------------------------------------------------- |
| 1   | 服务端事件 reminder 派生 hook（INSERT/UPDATE 同 tx）         | 0.5 d | `server/src/handlers/event.rs` + `unit tests`              |
| 2   | 服务端 reminder dispatcher + spawn              | 0.5 d | `server/src/reminder_dispatcher.rs` + main.rs 注册 + unit tests       |
| 3   | Desktop Tauri plugin 接入 + Adapter.notifications | 0.5 d | `Cargo.toml` + `lib.rs` + `capabilities/default.json` + `tauri.ts` |
| 4   | Android Tauri manifest 权限 + 通知 channel + 运行时申请      | 0.5 d | `AndroidManifest.xml` + Rust `#[cfg(android)]` init          |
| 5   | Web Toast 组件 + Notification API + poller 集成       | 0.5 d | `ReminderToast.tsx` + `lib/notifications.ts` + App 挂载    |
| 6   | E2E + Spec + commit                         | 0.5 d | Playwright + 本 spec 编辑                                   |

### 3.6.9 不在范围（明确）

- ❌ **iOS**（D4 = A；等 #10 远期，证书成本高）
- ❌ **服务端推送通道**（Web Push / FCM / APNs）—— 客户端轮询足够 P0 验证；后续若要"app 关闭也能收"再单独排期（Phase 3+）
- ❌ **批量/全天事件 reminder 合并**（留 #16 通话导入 + #18 AI 教练）
- ❌ **提醒声音个性化**（#8 现状：默认系统提示音；不引入 asset 资源）
- ❌ **日历导入/导出**（ICS 双向同步留 #9）
- ❌ **重复事件 reminder**（recurring event 留 Phase 3+，当前 reminder 一次性 trigger）

### 3.6.10 与 §3.5 节奏提醒的关系

| 维度 | §3.5 cadence | §3.6 event |
|---|---|---|
| 触发 | 服务器 scheduler 小时级扫 contact 表 | 事件 INSERT/UPDATE hook |
| kind | `cadence` | `time`（受 CHECK 约束） |
| 关联 | contact_id 必填 | event_id 必填（contact_id 可选） |
| 去重 token | `{user_id}:{contact_id}:{thr}` | `event:{event_id}:{lead}` |
| 通道 | Web 端 ReminderPoller + CadencePoller | Web Toast + 三端原生通知（这次新加的） |

**两条路径并行不冲突**：cadence 提醒"该联系张三了"，event 提醒"明天 3 点的会"。事件 derived reminder 由 §3.6 闭环，cadence 仍走 §3.5 dispatcher。

---

## 4. 同步性能优化专项（P0 紧急，来自代码审查）

### 4.1 架构

- 协议三端点：`manifest / push / pull`，Bearer JWT 鉴权。
- 客户端 `sync_once` = **push-then-pull**（`src-tauri/src/sync/mod.rs` L108）。
- 后台定时器每 **300 秒（5 分钟）** 跑一次（`spawn_periodic`，mod.rs L69-104）。

### 4.2 根因（按严重性）

**🔴 根因 1（致命，自激源头）—— 服务端 LWW 用了 `>=` 而非 spec 规定的 `>`**

- Spec（sync-engine-v0.2.0b-design.md L66-69）明确：`payload.updated_at > server.updated_at` 才 accept；`==` 应判 `tie_409` 冲突，**不写库、不 bump**。
- 实现（server `handlers/sync.rs` L211）：`updated_at >= existing_ua` —— **等于也算接受**。
- 后果：客户端每周期把未变行也上传（根因 2），服务端对这些 `updated_at == server` 的行执行 `ON CONFLICT DO UPDATE` → 即使值相同也触发 → **11 个 trigger 全部 firing** → 抬高 `server_revision` + 写 `sync_change_log`。
- **这是 revision 虚高、change_log 每周期膨胀、pull 永远拉回全量的直接原因。**

**🔴 根因 2 —— 客户端全量 push，无增量过滤**

- `push_all`（mod.rs L198-202）是 `SELECT {cols} FROM {table} WHERE user_id = ?1`，**不带 revision 过滤**，每周期把该用户所有表所有行序列化上传。
- `last_pushed_revision` 已记录（L135-137）但**从未用于过滤**；spec 设计的 `since_revision` 服务端 `push` handler 根本没读。

**🟠 根因 3 —— 客户端 pull 落地逐行 autocommit，无事务**

- `apply_change`（L324-433）对每行单独 `stmt.execute`（L416），无事务包裹。拉回数千行 = 数千次独立事务。

**🟠 根因 4 —— 服务端 push 每行独立事务 + 每行多次查询**

- 服务端对**每一行** `pool.begin()` → `set_config` → `SELECT updated_at` → upsert → `commit`。N 行 = N 事务 + 3N 查询 + 11N trigger。

**自激循环**：

```
每 5 分钟:
  客户端全量上传 N 行 (根因2)
    → 服务端对未变行也 re-upsert (根因1, >= 含相等)
      → 全部 N 行 bump server_revision + 写 change_log
        → 下次 pull 拉回全部 N 行变更
          → 客户端逐行 INSERT OR REPLACE (根因3)
            → 永不收敛, change_log 无限增长
```

**放大**：N 行数据，每周期 ~~N(HTTP序列化) + N(upsert) + 11N(trigger) + N(本地落地) 次操作。N 上千时单次同步秒~~十秒级，且随数据量线性恶化。

### 4.3 修复方案

| #      | 修复                                                                                   | 改动量      | 效果                      |
| ------ | ------------------------------------------------------------------------------------ | -------- | ----------------------- |
| **F1** | **服务端 `>=` 改 `>`**；`==` 时**静默 no-op**（不 bump、不写 log、不返回 conflict）                    | 1 行 + 分支 | **立即止血**：断自激循环          |
| **F2** | **客户端增量 push**：用 `last_pushed_revision` 记"已推最大 `updated_at`"，只推 `updated_at > 该值` 的行 | 中        | 日常同步 O(N)/5min → O(变更数) |
| **F3** | **客户端 pull 包事务**：`conn.transaction()` 包裹整个 apply 循环                                  | 小        | 首拉/大拉快一个数量级             |
| **F4** | **服务端 push 合并为单事务**                                                                  | 小        | 减少事务开销与 trigger 重复提交    |
| **F5** | **`sync_change_log` 定期 prune**（snapshot-prune 或 90 天 TTL）                            | 中        | 防日志无限增长                 |
| **F6** | （可选）大推送分片 + 服务端 bulk upsert 绕过 trigger                                               | 大        | 极大体量进一步优化               |

> ⚠️ 时间戳精度：若 `updated_at` 仅秒级，同秒两次编辑可能撞 `==`。F1 把 `==` 当 no-op 更稳妥；如需，客户端写时改用毫秒精度时间戳。

**预期**：F1+F2 让"同步很慢"在日常性化（只传真实变更）；F3 让首拉明显提速。**先上 F1（一行改动，零风险止血），再排 F2/F3。**

---

## 5. 技术债与 spec/实现偏差（待排期）

> **2026-08-09 全量复核**：除 §5.7（已修复）外，以下逐项逐代码核实，多数条目已过时或已实现，仅状态需修正。当前**无未决技术债**。

1. **密码哈希算法不一致** ~~桌面端 bcrypt / 云端 argon2~~ —— **2026-08-09 已核实：无冲突**。server `register`（auth.rs L286 `bcrypt::hash`）与 `login`（L390 `bcrypt::verify`）实际使用 bcrypt；argon2 仅用于 **API key**（`api_key.rs` + `lookup_api_key`）。桌面端同用 bcrypt。无需统一，无需重设密码。（Cargo.toml 双依赖为有意设计，勿删。）
2. **产品改名未清理** —— **2026-08-09 已清理 ✅**：identifier 实为 `com.weavine.desktop`。`PHASE1_VERIFICATION.md`、`docs/superpowers/specs/2026-07-04-multi-device-sync-design.md`（keychain `com.weavine.desktop.sync`）、`docs/superpowers/plans/2026-07-02-prm-three-platform-migration.md`、`.sisyphus/plans/2026-06-28-phase1-tauri-desktop.md` 全部更新。git grep 源码零残留（仅 `src-tauri/gen/` 构建产物含旧值，已忽略）。
3. **Push 响应字段偏差** —— **spec 对齐实现（2026-08-09）**：实现返回 `accepted[]`（sync.rs L96 定义 / L354 返回），客户端 `mod.rs:312` 消费 `accepted`。正式契约字段名为 **`accepted[]`**，旧 spec 表述 `applied[]` 作废。
4. **tombstone / change_log 清理** —— **2026-08-09 已实现**：`server/src/handlers/sync.rs` `prune_change_log()`（L450），`main.rs:167` 启动时调用，TTL 90 天（`CHANGE_LOG_TTL_DAYS`）。不再 defer。
5. **关联表 `id` 语义两端不对称** —— **保留为已知设计（2026-08-09 确认）**：SQLite 复合 PK / PG 额外 UUID `id` 为有意不对称，跨端由客户端 `add_junction_id`（translate.rs L177）补 UUID 对齐。§5.7 修复后 round-trip 实测验证可用，无需改动。
6. **鉴权 RS256 接入** —— **2026-08-09 已核实：已接入**。`server/src/auth_keys.rs` 用 `EncodingKey::from_rsa_pem`/`DecodingKey::from_rsa_pem` 从 PEM 加载，`auth.rs` `verify_access`/`issue_access_token` 均显式 `Algorithm::RS256`。运行时为 RS256，非 HS256。（注：桌面端 Tauri 进程内的 `jwt_secret()` 走 env HS256——那是本地模拟实现，与云端 RS256 不冲突。）
7. **【2026-08-09 审计新增·P0·已修复 ✅】同步白名单遗漏 `entity_link`/`media`**：原 `server/src/handlers/sync.rs` 的 kind 白名单（L147-166）仅含 contact/tag/project/event/action/interaction/reminder/setting/contact_tag/project_contact，**不含 `entity_link` 与 `media`**——push 时服务端落入 `unknown entity kind` 分支拒绝 → 事件参与者（entity_link）与头像（media）无法跨端同步，且每轮同步稳定产生 conflict。另：PG 表名 `entity_links`（复数）与客户端 `entity_link`（单数）不一致，pull 方向同样失败。**2026-08-09 已修复并 round-trip 实测通过**：①服务端白名单补 `"entity_link" => "entity_links"`、`"media" => "media"`,UPDATED_AT_TABLES 追加 `media`;②客户端 `kind_to_sqlite_table` 加复数别名 `entity_links → EntityLink` + `canonical_kind` 归一;③`push_columns("media")` 补 `storage_key/width/height/alt_text`(此前缺列导致 not-null violation 是另一半根因);④`apply_change` 用 canonical kind 走映射;⑤实测:push entity_link/media 均 accepted,pull 返回复数 `entity_links` kind 完整闭环;⑥`cargo test -p weavine --lib` 27 passed。**P0 阻塞已解除。**

8. **【2026-08-17 v1.0.9 修复纪要·P0 sweep·全部已修复 ✅】**：详见 header「最近更新」一行 + §6 Phase 2.7。修复要点：(1) **`commands/media.rs` `updated_at` 格式 P0-a** —— 桌面 `upsert_media` / `delete_avatar` / `delete_media` 全用 `%Y-%m-%d %H:%M:%S` 空格格式,全局游标 `KEY_LAST_PUSHED_AT` 是字符串 max,空格 ASCII(0x20) < `T`(0x54),一旦推到 Z 行后续空格 media 行 string-cmp 永远 `<` 游标饿死。改为 Z 格式 `%Y-%m-%dT%H:%M:%S%.3fZ` 与全栈对齐。(2) **桌面 `upload_avatar` / `delete_avatar` 缺 Contact 镜像 P0-b** —— `Media` 行已 upsert 但 `Contact.avatar_storage_key` 未更新,桌面无 DB trigger(server 端有 `sync_contact_avatar` trigger,桌面无对应物)。手动镜像 `Contact` 行 + 修 `get_avatar` `data_dir()?.join(&user_id).join(&filename)` 路径 bug(filename 列实际存的就是 storage_key,导致双 join)。(3) **桌面头像 / 名片图渲染路径缺失** —— `avatarUrlFor(contact, { baseUrl: '' })` 在桌面 WebView 返回 `/files/{key}` 相对 URL,Tauri 无 `/files/` handler → 404 → 兜底 initials。注册 `register_uri_scheme_protocol("files")` 接管 `files://localhost/files/{key}` 从 `data_dir()` 服务,`TauriAdapter.baseUrl='files://localhost'` 让所有 `avatarUrlFor` / `cardImageUrl` 命中协议。Web 端不动(server `/files/` 路由正常)。(4) **`server now_str()` Z 统一** —— `handlers/mod.rs:32` 改 Z 格式;之前 server 写空格、client 写 Z,`sync.rs` LWW string-cmp 不可靠;同时 `archive_sweep`/`archive`/`cadence_server`/`activation` 用 `DateTime::parse_from_rfc3339` 解析 server 自己的 `updated_at` 字串,空格格式直接 fail。auth.rs 故意不改(refresh_token expiry 自洽且与跨端同步无关)。(5) **QuickCapture 静默失败** —— `submit()` 早 return 路径 `if (!trimmed || !userId) return;` 在 `useUserId()` 未解析时吞掉,改为两步检查,userId 空时 `setError('本地用户尚未就绪')`。(6) **ContactDetail avatar 错误吞成通用文案** —— Tauri v2 `invoke` 拒绝时返 raw Rust `String` 不在 `Error` 实例上,`err instanceof Error ? err.message : '头像上传失败'` 第二分支吞噬真因。改为 `String(err)` 透出,加空字节防御。(7) **Re-OCR 入口位置 UX 决策** —— 从 `ContactDetail`(只读查看页) 移到 `ContactEdit`(编辑页),详见 §7 Q9。

---

## 6. 实施路线图（合并两条路线）

```
Phase 0  紧急止血      F1(>= → >)                    ✅ 已完成 (e0ce6a8 严格 LWW)
  │
Phase 1  地基          #3 事件多人 + 联系人间边 ✅ | #12 同步优化 F2/F3/F4/F5/F6 ✅
  │                  (本地全功能落地; 跨端同步已闭环 §5.7)
Phase 2  护城河+可用    #4 关系图谱 ✅ + #1 头像 ✅ + #5 查找即新建 ✅ + #11 名片提取 ✅
  │
Phase 2.4 重要度清理     Contact.importance 3 档统一（low/medium/high 默认 low）+ 删 reminder 死字段（前置 §3.5）🟡 设计已批准 → 实施中（约 1.5 人/日，2026-08-09）
  │
Phase 2.5 快速捕获中枢  §3.5 子系统（#13 语音 + #14 节奏 + #15 互动扩展）🟢 已实施（2026-08-10，6 个 commit，3 个 E2E 测试通过）
Phase 2.6 事件提醒中枢  §3.6 子系统（#8 提醒 + event.reminder_lead_minutes 闭环 + 桌面/Android/Web 原生通知通道）🟢 已实施（2026-08-11，3 个 commit，2 个 E2E 测试通过，桌面/桌面/Android/Web 全通道接入）
  │
Phase 2.7 bugfix sweep  v1.0.9 P0 修复纪要（§5.8）🟢 已发布（2026-08-17，tag v1.0.9，commit e38762f，6 文件变更，11/11 e2e 全绿）
  │
Phase 3  变现+合规      #9 云选型 + #6 onboarding/套餐   ⬜ 待做
  │
Phase 4  增强           #8 提醒声音 ✅ → #10 移动端小模型 ⬜ → #2 合影头像 ⬜
  │
Phase 5  中国特性深化   #16 通话导入 → #17 会议简报 → #18 引荐洞察 → #19 机会看板 → #20 AI教练/起草
  │
收尾     技术债         §5 改名清理 / 密码哈希统一 / §5.7 同步白名单修复(P0) ✅ 已完成
```

**关键路径**：`#3（事件侧）→ #4 关系图谱` 已完成；`#12 同步性能 F1–F6` 已落地；§5.7 同步白名单断链已修复（#3/#1 跨端已解锁）；**Phase 2.5 §3.5 子系统设计已批准（2026-08-09 brainstorm），进入实施**。中国特性需求以 **#14 节奏提醒**为 P1 抓手、**#15/#16 本地捕获**为数据积累底座（替代西方"自动流入"）。

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

**目标**：把"多少人用了 Weavine"从"只看付费 / 登录用户"扩到"全漏斗：安装→首次使用→30 天留存→登录→付费"。未登录用户也应该在统计里——否则 P0/P1 优化只盯付费用户会严重误导。

**原理**：每个 Tauri / Web SPA 客户端在首次启动时（5 s 延迟，避免抢 boot）向 `POST /api/activation/ping` 注册一个客户端自己生成的 UUID v4 (`install_id`)，存在 `<data_dir>/install_id`（Tauri）或 `localStorage[weavine:install_id]`（SPA）。后续每次 OCR / 语音调用把 `X-Install-Id` + `X-Client-Platform` + `X-Client-OS` + `X-App-Version` 一起带上，server 在 `handlers/ocr.rs` / `handlers/voice.rs` 里 `record_activation_hook` 增 `call_count` + 改 `last_event`。

### 11.5.1 数据模型

**`install_activation` 表**（migration `20260814000001` + `20260820000001`）：

| 字段 | 类型 | 用途 |
|---|---|---|
| `install_id` | TEXT PK | 客户端生成 UUID v4 |
| `first_seen_at` / `last_seen_at` | TEXT | ISO8601 UTC |
| `app_version` | TEXT | `"1.0.4"` |
| `os` | TEXT | `"darwin"` / `"windows"` / `"linux"` / `"android"` |
| `platform` | TEXT CHECK (`desktop|android|web`) | 运行时类型 |
| `last_ip_hash` | TEXT | `SHA-256(JWT_SECRET || ip)`，**原始 IP 不存** |
| `call_count` / `last_event` | INTEGER / TEXT | OCR/voice 调用计数 + 最近一次事件类型 |
| `device_key` | TEXT UNIQUE partial idx | server-minted 32-char hex，替代共享 `WV_SERVICE_KEY` |
| `plan` / `daily_ocr_count` / `daily_voice_count` / `daily_reset_at` / `revoked_at` | 预留给 quota 体系 | **v1.0.9 部分启用**：FREE 100/天，TRIAL 50/天，PRO 不限；仅匿名 `device_key` 路径走 quota，登录用户 / `SERVICE_KEY` 不限；常量见 `server/src/handlers/activation.rs` |

### 11.5.2 客户端 → server headers（每次 cloud 调用）

```
X-Device-Key:     <32-char hex>          // server 验证 install_activation.device_key
X-Install-Id:     <UUID v4>              // record_activation_hook 用
X-Client-Platform: desktop|android|web   // 进程检测
X-Client-OS:      <os name string>
X-App-Version:    <weavine version>
```

### 11.5.3 鉴权优先级（取代 v1.0.2 的 `extract_auth`）

```
extract_endpoint_auth() -> EndpointAuth
  = AnonymousDevice { install_id }  // X-Device-Key 命中 install_activation.device_key
  | User { user_id, device_id }     // JWT 或 API key 有效
  | ServiceKey                      // X-Service-Key == WV_SERVICE_KEY (dev / CI only)
```

顺序：`X-Device-Key` → `Authorization: Bearer ...` / `X-Api-Key` → `X-Service-Key`。

匿名用户调 OCR / voice 不需要登录，server 通过 `device_key` 知道是哪个 install。`register()` / `login()` 后同一 `install_id` 变成 `devices.id`，所以 `JOIN install_activation ON install_id = devices.id` 直接出"一个用户 N 个设备"的漏斗。

### 11.5.4 隐私红线（README "Activation tracking" 节）

- 原始 IP **永不落库**，只存 `SHA-256(JWT_SECRET || ip)`（不可逆，跨 install 不可关联）。
- `install_id` 是客户端 UUID v4，**零指纹**——不基于 machine-id / browser fingerprint / 屏幕分辨率 / IMEI / IDFA。
- 客户端**只**向用户配置的 server URL 发，不会向任何第三方打点。
- 用户可随时关：删 `<data_dir>/install_id` + `<data_dir>/device_key`，或清 `localStorage[weavine:install_id|weavine:device_key]`——下次启动 = 新 install。

### 11.5.5 关键查询（`docs/activation.sql` 共 10 条）

- DAU / MAU 唯一安装数
- 三端平台分布
- 多设备用户漏斗（1 个 user_id 对应 N 个 install）
- 匿名→已登录 cohort 转化率
- 每日 quota 计数（plan enforcement 用，schema 已就绪）

### 11.5.6 拍板记录（2026-08-14 brainstorming）

- **Q1 怎么识别"同一用户多端"？** → `install_id` 同时作为 `devices.id` PK，登录时合并。
- **Q2 OCR / voice 是否走同一套？** → 是，server 端 `record_activation_hook` 同源。
- **Q3 是否仍需 `WV_SERVICE_KEY`？** → 仅作 dev / CI / 单元测试 fallback，prod 客户端走 `device_key`。
- **Q4 quota 怎么落？** → `install_activation.daily_ocr_count` / `daily_voice_count` + `daily_reset_at`，v1.0.4 schema 已加；**v1.0.9 部分启用：FREE 100 次/天，TRIAL 50 次/天，PRO 不限。仅匿名 `device_key` 路径走 quota，登录用户 / `SERVICE_KEY` 不限。**详细常量见 `server/src/handlers/activation.rs`。

### 11.5.7 不在范围（明确）

- ❌ 用户行为分析（点击流 / 浏览路径）——不是产品定位，留给外部 BI 工具
- ❌ 推送通知到达率统计——后续若 #3 / §3.6 接 server 推送再排
- ❌ 多 server 端聚合（每个 weavine-server 部署自己的统计）——单租户定位无需
- ❌ 删除 install_activation 行（用户卸载 app）——只是 `last_seen_at` 不再更新，30 天后可清理

---

*本文档（工作区维护版）与项目根目录 `Weavine-产品需求Spec.md` 已合并统一（2026-08-09）：以本文档为真相源，吸收项目根目录版「✅ 全部落地」的代码复查结论（git HEAD `4b701e4`，含 §5.7 同步白名单修复），并保留本文档独有的中国市场原则（§11）、#13–#20、排除每日摘要、§10 平台策略，以及 §5.7 同步白名单断链（P0）记录（已于 2026-08-09 修复）。对应的 weavine 子待办统一挂在项目 `Weavine`（`a119f2d7-4b87-4ce9-ac4b-015ab75ea257`）下。*

*2026-08-09 追加：本文档升格为 **产品蓝图**（v1.1），锁定为唯一权威需求来源；§3.5「快速捕获与节奏中枢」子系统设计（合并 #13 / #14 / #15，跨端 Ctrl+K + Android 语音 + 节奏提醒，亲密 14 / 重要 45）已批准，进入 Phase 2.5 实施。所有后续需求、状态调整、平台策略、中国特性、技术债均回写本文档，不再创建独立 spec 文件。拍板溯源详见 §7.1。*

---

## 11.6 语音识别架构定稿（2026-08-20 拍板，国内为主市场）

> 演进溯源：D3（2026-08-09）原定 Android 走 `tauri-plugin-android-speechrecognition` 原生 plugin；v1.0.19 起实施演进为 **sherpa-onnx 端上 ASR**（国行无 GMS、原生 SpeechRecognizer 不可用），本节约为当前权威结论。

### 11.6.1 分层架构（按端能力选最稳）

| 端 | 主路径 | 兜底 | 理由 |
| --- | --- | --- | --- |
| **Web** | Web Speech API（国内实测可用：Safari 走 Apple 后端 / Chrome 代理直连 Google） | 服务端 whisper REST `/voice` | 零成本、准；墙内/不支持浏览器回退服务端（修 #46） |
| **Desktop（Win/Mac/Linux）** | sherpa-onnx 端上（Rust command，离线、零服务端成本、无 Google 依赖） | 服务端 whisper | Tauri 原生壳能跑端上；比 Web Speech 更贴 offline-first |
| **Android** | 同一套 Rust 核心（编译 android target）端上 sherpa-onnx | 服务端 whisper | 国行无 GMS 无法用 Web Speech / 原生 SpeechRecognizer |
| **统一** | — | 服务端 whisper 始终保留 | 长录音/噪声/低端机/模型未下载时降级 |

> **明确不采用**：原生 `SpeechRecognizer`（国行 GMS 不可用）、纯 Web Speech 作全端主路径（国内墙 + 非离线 + Google 隐私依赖）。

### 11.6.2 ASR 模型拍板：SenseVoice int8 主档 + whisper tiny 兜底

- **主档模型**：`sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`（阿里达摩院，非自回归 CTC，中英日韩粤自动检测）。
  - 中文准确率、标点、ITN 数字归一化（"一百二"→"120"）显著优于 Whisper tiny；推理更快；附赠情感/音频事件标签。
  - 启用 `use_itn=true` 提升落库文本质量。
- **低端机兜底**：≤3GB RAM 设备跑 239MB 模型有压力 → 保留 whisper tiny（75MB）作低档 fallback。
- **体积/内存代价**：SenseVoice int8 ~239MB、运行内存 ~400MB；首次使用**按需下载**，不打进 APK。
- **许可证**：FunASR Model License v1.1（免费可用，商用需保留署名/声明）。

### 11.6.3 模型下载源（国内）

- **国内源 = 魔搭社区 ModelScope（modelscope.cn）**，避免 GitHub releases 被墙。
- 推荐仓库（sherpa-onnx 转换版，weavine 用此）：`Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`（含 `model.int8.onnx` 239MB + `tokens.txt`）。
- 下载方式（任选）：
  - 单文件直链：`https://modelscope.cn/models/Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/master/model.int8.onnx` + 同目录 `tokens.txt`
  - `git clone https://www.modelscope.cn/Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.git`
  - ModelScope SDK：`snapshot_download('Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')`
- **约束**：sherpa-onnx 要求 `model.int8.onnx` 与 `tokens.txt` **同目录**；下载逻辑写进 `voice_local.rs` 模型配置，落 App 私有目录。

### 11.6.4 Android 启动闪退修复记（v1.0.x）

- 现象：Android build 成功但打开即闪退。
- 根因 1：`MainActivity.kt` 被误删（manifest 引用 `.MainActivity` 但源码缺失 → ClassNotFoundException）。已恢复空壳 `class MainActivity : TauriActivity()`。
- 根因 2：sherpa 的 3 个 .so（`libsherpa-onnx-c-api.so` / `libonnxruntime.so` / `libc++_shared.so`）未打进 APK（build.rs 拷贝目录错位），`Rust.kt` 启动 `loadLibrary` 失败。已修拷贝逻辑。
- **遗留**：`gen/` 在 gitignore → `MainActivity.kt` 等手写文件无版本保护，建议在仓库留副本 + 构建脚本拷贝（或 `git add -f`），避免再次误删复现。

### 11.7 md 文件编辑器 + 显式「导入库」架构定稿（2026-08-26 拍板）

> 背景：用户提出让 weavine 也能打开/编辑本地 `.md` 文件，以扩大使用范围、提高打开频次与粘性。经三轮讨论收敛为如下 v3 模型（2026-08-26）。

**一句话定位**：**Windows / Linux / macOS 三桌面版**同时是本地 `.md` 编辑器；打开/编辑任意 `.md` **只读写文件、不写库、不参与云端同步**。只有当用户显式点「导入库」时，才把当前文件内容作为一条笔记复制进 weavine 笔记库（可关联、可同步）。Web 与移动端不在本期。

#### 11.7.1 三态模型（关键，彻底规避双副本分歧）
- **编辑器态（打开外部 `.md`）**：纯文件编辑。保存（Ctrl+S）= 仅写回原文件。不创建/更新任何库记录，不触发 sync。
- **库笔记态（导入后）**：成为 `Note` 表 + `EntityLink` 体系内的一等公民笔记，可关联联系人/项目/待办/日程/互动，随库同步。
- **导入是显式桥接（一次性快照语义）**：「导入库」把**当前文件内容**复制进库，并记 `imported_from`（原路径）+ `imported_at`（时间）作为来源留痕。导入后文件再被外部改动**不影响**库副本（库是 canonical，文件是 source 快照）。

> 为什么不做"保存时同时写文件和库"：那会让"文件"和"库"成为同一笔记的两个副本，各自可独立改动 → 双副本分歧（mtime 对账 / 静默覆盖）。v3 用"编辑器态完全不碰库"彻底规避，且无跨设备文件冲突（文件本就不入同步）。

#### 11.7.2 重导入语义（Re-import）
对同一路径再次「导入库」（已存在 `imported_from` 命中）时：
- **快速路径**：若文件 mtime ≤ 该 note 的 `imported_at`（文件没被外部改动过），自动跳过、toast 提示「该文件已是最新，无需重导」；
- **冲突路径**：若文件 mtime > `imported_at`（外部改过了），**弹选择框**：
  - **更新已有笔记**：覆盖该 note 的 `body`（不动 `title` 与 `EntityLink`，避免破坏已有关系网），`imported_at` 刷新；
  - **跳过**：什么都不做；
  - **作为新笔记导入**：保留原 note 不动，新建一条 note 携带相同 `imported_from` 路径。

> 不做静默覆盖——重导入是少数必须打扰用户的时刻，避免用户工作被静默丢失。
> 此语义让 §11.7.7 的「导出 `.md`」自然闭环：导出时**显式用 `setFileTimes` 将文件 mtime 设为 `note.imported_at`**，使其再次被 weavine 重导时 mtime ≤ imported_at → 走快速路径（「已是最新」），无摩擦。若平台/FS 不支持改 mtime，则回退为正常弹选择框，不影响正确性。

#### 11.7.3 隐私、信任与编码
- 打开任意 `.md` ≠ 把文件交给 weavine；未点「导入库」前，文件内容不出本机、不上云。契合 §11.1「数据主权」叙事，避免"打开即同步"的惊吓感。
- **编码策略**（国内用户为重要使用场景，P0 细节）：
  - 读时自动嗅探 UTF-8（默认）/ UTF-8 BOM（自动剥）/ GBK / GB18030；
  - 写回统一 UTF-8 无 BOM；
  - 不可表示字符 → 弹"无法保存"明确错误，不静默吞漏。
- **不监听文件外部改动**：编辑器打开期间，外部修改该 `.md` 不触发自动覆盖（避免互相打架）。关闭编辑器时若检测到 mtime > 打开时的 mtime → 弹「磁盘已变化」三选项（**重新加载** / **保留我的修改** / **取消关闭**）。

#### 11.7.4 三平台分发杠杆（顶级漏斗入口）

| 平台 | 注册机制 |
|---|---|
| Windows | WiX/MSI 安装程序注册 `.md` 默认打开程序（`HKCR\.md` + ProgID） |
| macOS | `Info.plist` 通过 `CFBundleDocumentTypes` + `UTExportedTypeDeclarations` 注册 `net.daringfireball.markdown` UTI |
| Linux | `.desktop` 文件 `MimeType=text/markdown;`（deb / AppImage 安装时打入） |

资源管理器 / Finder / Nautilus 双击 `.md` → weavine 以纯编辑器打开（无上传惊吓）→ 用爽后按需「导入库」。这是 web/Android 做不到的顶级漏斗入口。

**冷启动 argv 处理**（OS 关联必须，否则双击会闪退或开多进程）：
- `tauri-plugin-single-instance`：双击触发第二次启动 → argv 转发到首实例 → 在主窗口新 tab 打开该文件，不开新进程、不闪屏；
- 启动时解析 `argv[1]` 为文件路径；解析失败 → 不闪退，回主界面 + toast「无法打开该文件」。

#### 11.7.5 文件大小策略

| 大小 | 编辑器态（打开/编辑/保存文件） | 「导入库」 |
|---|---|---|
| 任意大小 | **始终允许**——双击即用 weavine 打开、编辑并 Ctrl+S 写回磁盘，不限制文件体积 | — |
| ≤ 1 MB | 正常 | ✅ 允许导入库 |
| > 1 MB | 正常（超大文件顶部轻量 banner「文件较大，编辑器性能可能下降」） | ⛔ **置灰禁用**，提示「文件超过 1 MB，导入库会拖慢同步与备份」 |

> 设计选择：编辑态只碰本地文件、不进库、不占云端，所以**不限制编辑大小**；但「导入库」会把内容写入 `Note` 并参与 LWW 同步，1 MB 阈值是为了避免单条 note 撑大 SQLite + 拖慢同步（库内 note 一般 < 100 KB，1 MB 已属极端）。超过即不引入库，但本地纯编辑仍支持（满足"想用 weavine 临时看一眼 / 改一下大文件"的需求）。

#### 11.7.6 编辑器 MVP UX

**做**：
- 编辑 / 预览分屏切换按钮
- 主题跟随 weavine 系统设置（亮 / 暗）
- **自动保存关闭**（避免悄悄写用户文件）
- 脏标记 + 关闭 / 切 tab 时未保存拦截（弹"是否保存"三选项：保存 / 放弃 / 取消）
- 行号、查找替换、字数统计
- 外部文件监视关闭（见 §11.7.3）

**不做**（明确）：
- 协同编辑、AI 补全、Vim mode、表格可视化、宏、插件
- wikilink `[[xxx]]` 解析（保留原文以便未来升级为可选功能）

**编辑器态隐藏**：关系面板、backlink 区、`EntityPicker`、`@` 智能建议——避免干扰"只想写个字"的用户。导入后才出现关联能力。

#### 11.7.7 导入即关联 + 导出闭环
- 「导入库」时弹 `EntityPicker`（复用现有能力），并按正文 `@人名` 自动建议关联，把外来文件挂上关系网（weavine 相对 Typora / VS Code 的差异化）。
- 库内笔记支持「导出 `.md` 文件」回到磁盘，形成闭环（强化数据可携）。导出文件**不含 frontmatter**——保留纯 markdown，未来若做双向同步可平滑升级。

#### 11.7.8 最近文件（Recent files）
- 路径列表存于 `sync::config` SQLite KV 表（key `recent_files`），存最近 10 条 `{path, last_opened_at}`；按 LRU 淘汰。
- `File → 最近` 菜单列出，点击即打开对应 `.md`（路径不存在则提示"文件已被移动或删除"，从列表中移除）。
- **不跨设备同步**（路径无意义）。

#### 11.7.9 数据模型增量（实施时落 migration）

**桌面 SQLite `Note` 表**（新增两列）：
- `imported_from TEXT`（来源文件路径，仅编辑器态导入的记录有值；纯库笔记 NULL）
- `imported_at TEXT`（来源时间，ISO8601 Z）

**服务端 Postgres `note` 表**（**不加**这两列）：
- `imported_from` 是本机路径，上云泄露用户文件系统布局、跨设备无意义。
- desktop → server sync translate 时显式 drop：避免 web SPA 用户看到 `C:\Users\...` 路径造成隐私事故。

**Migration 文件**（明确）：
- desktop: `src-tauri/migrations/2026xxxx_imported_from.sql`（加两列）
- server: **本期不加列、不写 migration**；列从一开始就不存在，无 drop 必要
- sync translate: `sync/translate.rs::translate_note_local_to_server` 显式 `note.remove("imported_from"); note.remove("imported_at");`（防止后续误加列时泄露）
- 防御性 add migration（仅当服务端未来误加列时使用，**本期不创建文件**）：`server/migrations/2026xxxx_drop_imported_from.sql`

#### 11.7.10 平台范围
- **本期范围**：Windows / Linux / macOS 三桌面端均支持 `.md` 编辑 + 导入库 + 导出 `.md` + 文件关联注册 + 最近文件。
- 三平台共用同一编辑器实现；差异仅在 bundle 元数据（`tauri.conf.json` → Windows WiX / macOS Info.plist / Linux .desktop）。
- **不在本期**：Web、移动端；但库内已存在的笔记在 web/移动端已有能力可查看。

#### 11.7.11 不在范围（明确）
- 不做"保存双写文件+库"——彻底规避双副本分歧。
- 不做 Obsidian 式 `[[wikilink]]` 双链解析（关联走 `EntityLink`）；但保留原文 `[[xxx]]` 串以备未来扩展。
- 不把外部文件路径纳入云端同步（`imported_from` 在 server drop）。
- 不做协同编辑、外部编辑器插件、AI 补全、Vim mode、表格可视化。
- 不监听编辑器态期间的文件外部改动（见 §11.7.3）。
- 不支持 `.markdown` / `.mdown` / `.mkd` 等扩展名变体（仅 `.md`，覆盖 99% 用例；变体可后续再加）。

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

## 13. 代码现场发现的 quick wins / 缺口（2026-08-17 自动巡检）

> **状态**：与 §12 并列的"小而急"清单。**不发布新版**。来源于 `explore` 代理对全仓 `TODO/FIXME/console.log/stub/已知 bug` 扫描 + 直读 routes-config / handler 列表 / 平台差异文档。

### 13.1 P1 — 数据安全与可用性（必做）

##### 🆕 #34 sync boolean 翻译 bug 修复

- **背景**：`src-tauri/tests/cloud_sync.rs:9-12` 注释里标注："Known issue: the second `sync_once` push trips a translate bug (`invalid input syntax for type boolean: ""`) when re-pushing seed rows. See TODO in src-tauri/src/sync/translate.rs for the boolean fix."
- **风险**：二次推送种子数据会触发 sync 翻译层 type cast 异常 → 数据写入失败 → 可能静默丢数据。
- **范围**：S1 — 修复 `sync/translate.rs::boolean_columns()`，加回归测试覆盖二次推送。

##### 🆕 #35 Web PWA 云端 sync 缺失

- **背景**：`apps/web-spa/src/lib/adapter/http.ts:450-455` —— `cloud = { status/login/logout/syncNow: () => Promise.reject(new Error('cloud sync is desktop-only')) }`。
- **影响**：PWA 用户完全无法 sync。登录后服务起落本地可写但跨端不通。
- **范围**：S2 — 4 个 endpoint 走 REST 调用 `/api/auth/*` + `/api/sync/*`。

##### 🆕 #36 weavine-mcp lib 补全

- **背景**：`weavine-mcp/src/lib.rs:1` 1 行 stub：`// stub — real implementation comes in Task 4`。
- **影响**：MCP 二进制可跑但 lib crate 不可被其他 crate 依赖。
- **范围**：S1 — 重导出内部模块。

### 13.2 P2 — 用户可见的 papercut（一周内可做）

##### 🆕 #37 生产环境 console.log 清扫

- **背景**：5 文件 15+ 处 `console.log/warn/error` 留在生产代码：
  - `routes/ContactDetail.tsx:168-197` — 7 处 `[avatar-pick]` / `[avatar-upload]` 日志
  - `lib/adapter/http.ts:495-508` — 4 处 `[avatar-upload]` 日志
  - `routes/Settings.tsx:407` — `[cloud sync]` result
  - `lib/use-reminder-poller.ts:54,83,97` — 3 处 `console.warn`
  - `routes/ContactNew.tsx:53` — `console.error('save card image failed:', e)`
- **范围**：S1 — 删除或用 `if (import.meta.env.DEV) console.log(...)` 包住。

##### 🆕 #38 桌面 adapter api_keys + graph 接入

- **背景**：`apps/web-spa/src/lib/adapter/tauri.ts:387-405` —— 桌面端 `apiKeys` 和 `graph` 调 `Promise.reject('cloud-only/desktop-only')`。
- **影响**：桌面用户看不到 API 密钥管理 + 关系图谱（虽然 #4 已实现但走的是 web REST）。
- **范围**：S2 — 加 Tauri command（server handlers 已存在 `api_key.rs` / `graph.rs`）。

##### 🆕 #39 /stats 路由 + 仪表盘

- **背景**：
  - README 列出 "Stats — a small dashboard so you can see at a glance: who you haven't talked to in 60 days, how many new contacts this month, tag distribution"
  - 但 routes-config 没有 `/stats`，handler 列表没有 `stats.rs`（仅在 worktree `feat-overview-page` 分支存在）
- **影响**：README 在撒谎。这是 §12 #33 仪表盘的低成本先期版（聚合查询 + 简单列表即可）。
- **范围**：S2 — 加 `StatsPage` 路由 + 4 个聚合查询 + 简单列表展示。

##### 🆕 #47 README / 营销文案刷新

- **背景**：当前 `README.md`：
  - "Latest release: v0.2.23" — 实际已 v1.0.11
  - 平台尺寸：macOS DMG 6.9 MB / Windows MSI 7.9 MB / Linux DEB 6.9 MB / Android APK **64.6 MB** —— 实际 v1.0.8 MSI 6.89 MB / DMG 7.67 MB / DEB 8.91 MB / Android APK 24.19 MB（per-ABI split）
  - "iOS — Tauri 2 has experimental iOS support; aiming for v0.3" — iOS 不在路线
  - Roadmap 中 "Relationship graph — visual graph view" — 已落地（#4）
  - "Stats — a small dashboard" — 未落地（见 #39）
  - "Health score" — 列入长线 Roadmap，未落地（§12 #24）
- **影响**：对外文档与实际产品不一致 → 用户期望偏差。
- **范围**：S1 — 删除过时条款（iOS / Stats / Health score 移到 long-term），更新版本号 + 尺寸 + 平台列表。

##### 🆕 #41 `api_key_crypto.rs:38` `panic!` 改 Result

- **背景**：`panic!("WEAVINE_MASTER_KEY must decode to exactly 32 bytes")` —— 服务启动路径 panic。
- **影响**：环境变量配错时整个进程崩，而不是优雅退出并打印错误。
- **范围**：S1 — 返回 `Result`，main.rs 处理。

##### 🆕 #42 静态 export 动态路由失败

- **背景**：`/interactions/:id`、`/contacts/:id`、`/events/:id` 等动态路由在静态构建（web PWA）时会失败。
- **影响**：影响 SEO / 离线 PWA 可访问性。
- **范围**：S1 — 加 `generateStaticParams()` 或 fallback SPA shell。

### 13.3 P3 — 移动端体验打磨（Phase 4 可挑）

##### 🆕 #43 触屏目标尺寸审查（≥48dp）

- **背景**：UI 假设鼠标点击，部分 tap target 可能 < 48dp。
- **范围**：S2 — CSS 审查 + `@media (hover: none)` fallback。

##### 🆕 #44 Android 推送通知

- **背景**：移动端 reminder 当前只走 `tauri-plugin-notification`（Android 13+ 需 `POST_NOTIFICATIONS`）。
- **影响**：用户可能关闭 in-app reminder 时错过提醒。
- **范围**：S2 — 验证 manifest 权限 + Android 13+ 通知 channel 创建。

##### 🆕 #45 iOS scaffold

- **背景**：`docs/mobile-limitations.md` 标注 iOS 项目脚手架未建（需 macOS build host）。
- **范围**：S3 — 需要 macOS + Tauri 2 iOS support。

##### 🆕 #46 voice.ts:140 错误抛出 → Web 回退服务端 `/voice` REST（2026-08-20 修订）

- **背景**：`lib/voice.ts:140` —— `throw new Error('云端语音识别仅在 Tauri 客户端可用')`。
- **影响**：Web 用户若代码走到云端分支会抛 JS 异常；且 Web 当前缺失对 Web Speech 不可用的优雅降级。
- **范围**：S1 — 不再弹"请用桌面端"，改为 **Web 走不通 Web Speech 时回退到服务端 whisper REST `/voice`**（服务端 endpoint 已存在，见 §13.4 `ocr/voice` 行）；纯 Web 用户也能在国内墙内环境用语音。音频过服务端属隐私取舍，已接受。

### 13.4 跨栈一致性补全（与 §13.2 P2 重叠，已并列）

| 项 | Desktop | Server | Web | 缺什么 |
| --- | --- | --- | --- | --- |
| `cloud.sync*` | ✅ Tauri invoke | ✅ endpoint | ❌ reject | **#35** Web PWA |
| `api_keys.*` | ❌ reject | ✅ endpoint | ✅ REST | **#38** Desktop |
| `graph.*` | ❌ reject | ✅ endpoint | ✅ REST | **#38** Desktop |
| `ocr/voice` | ✅ invoke | ✅ endpoint | ✅ REST | OK |
| `quick.parse` | ✅ local | ✅ endpoint | ✅ REST | OK |

### 13.5 实施优先级（推荐 Sprint）

| 优先级 | 项 | 估时 | 风险 |
| --- | --- | --- | --- |
| 🔴 本周 | #34 sync boolean bug 修 | 0.5d | 数据安全 |
| 🔴 本周 | #47 README 刷新 | 0.25d | 营销一致性 |
| 🟠 下周 | #37 console.log 清扫 | 0.25d | 噪音清理 |
| 🟠 下周 | #41 panic → Result | 0.1d | 服务稳定 |
| 🟠 下周 | #36 weavine-mcp lib | 0.5d | 工具链 |
| 🟡 Phase 3 起步 | #35 Web PWA sync | 2d | 路线补齐 |
| 🟡 Phase 3 起步 | #39 /stats 仪表盘 | 2d | README 兑现 |
| 🟡 Phase 3 起步 | #38 Desktop adapter 接通 | 1d | 桌面体验 |
| ⚪ 移动打磨 | #42 #43 #44 #46 | 各 0.5d | 移动体验 |
| ⚪ 远期 | #45 iOS | 10d | 平台扩展 |

合计 P1+P2 ≈ **6.5 人/日**，可在一周内全部清掉，作为 Phase 3 的"健康基础"。

### 13.6 拍板记录（本节增项）

待用户回来 review 后填写：
- **Q15 #34 sync boolean bug 是否本周修？** → 用户拍板
- **Q16 #39 仪表盘是否单独做，还是合并到 §12 #33 Phase 3.5？** → 用户拍板
- **Q17 #47 README 刷新是否一起做？** → 用户拍板
- **Q18 iOS 路线是否继续（#45）？** → 用户拍板
