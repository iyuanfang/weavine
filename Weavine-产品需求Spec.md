# Weavine 产品蓝图（Product Blueprint / Spec）

> 版本：**v1.2（产品蓝图合并版）** ｜ 整理日期：2026-08-07
> **最近更新（2026-08-27 · v1.3.6/v1.3.7 落地）**：新增 §11.7「md 文件编辑器 + 显式『导入库』架构定稿」——三桌面版（Windows / Linux / macOS）打开本地 `.md` 仅作纯编辑器（保存只写文件、不写库、不参与云端同步）；仅「导入库」显式桥接进 `Note` 表 + `EntityLink` 体系（可关联联系人/待办/日程、随库同步、记来源路径+时间，`imported_from` 路径不上云——服务端 drop 防泄露）；库笔记可导出 `.md`；三平台安装注册 `.md` 默认打开程序（Windows WiX / macOS `Info.plist` UTI / Linux `.desktop` MimeType）+ `tauri-plugin-single-instance` 处理冷启动 argv。新增需求 #40。
> **最近更新（2026-08-28 · v1.3.10 落地，§11.7 增量）**：**OS 文件关联扩展到 docx / pdf / txt / html / htm / xlsx / pptx** —— §11.7 v1.3.6/v1.3.7 仅注册 `.md`；v1.3.10 新增这 6 类（Windows MSI / macOS UTI / Linux .desktop 三平台同步），前端契约不变（`open-md-from-argv` / `MdEditor` 既有转换流程）。commit `86cb08c` / tag `v1.3.10`。详见 §11.7.12。

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

---

*本文档（工作区维护版）与项目根目录 `Weavine-产品需求Spec.md` 已合并统一（2026-08-09）：以本文档为真相源，吸收项目根目录版「✅ 全部落地」的代码复查结论（git HEAD `4b701e4`，含 §5.7 同步白名单修复），并保留本文档独有的中国市场原则（§11）、#13–#20、排除每日摘要、§10 平台策略，以及 §5.7 同步白名单断链（P0）记录（已于 2026-08-09 修复）。对应的 weavine 子待办统一挂在项目 `Weavine`（`a119f2d7-4b87-4ce9-ac4b-015ab75ea257`）下。*

*2026-08-09 追加：本文档升格为 **产品蓝图**（v1.1），锁定为唯一权威需求来源；§3.5「快速捕获与节奏中枢」子系统设计（合并 #13 / #14 / #15，跨端 Ctrl+K + Android 语音 + 节奏提醒，亲密 14 / 重要 45）已批准，进入 Phase 2.5 实施。所有后续需求、状态调整、平台策略、中国特性、技术债均回写本文档，不再创建独立 spec 文件。拍板溯源详见 §7.1。*

---

## 11.6 语音识别架构（v1.0.19 落地，2026-08-20 拍板，国内为主市场）

**需求**：跨端（Web / Desktop / Android）统一提供语音输入能力；国行 Android 无 Google 服务（无原生 SpeechRecognizer、墙内 Web Speech 不可用），需端上 ASR 兜底。

**拍板**：

- **Web**：主路径 Web Speech API（Safari/Chrome 实测可用），兜底服务端 whisper。
- **Desktop（Win/Mac/Linux）+ Android**：sherpa-onnx 端上 ASR（同一套 Rust 核心编译多端），离线、零服务端成本、无 Google 依赖。
- **统一兜底**：服务端 whisper REST `/voice`——长录音 / 噪声 / 低端机 / 模型未下载时降级。
- **明确不采用**：原生 Android `SpeechRecognizer`（国行 GMS 不可用）、纯 Web Speech 作全端主路径（墙 + 非离线 + Google 隐私依赖）。

**模型拍板**：SenseVoice int8（中英日韩粤，达摩院，~239MB）作主档，whisper tiny（~75MB）作低端机兜底。首次使用按需下载，不打进 APK；下载源用国内 ModelScope 魔搭社区避免 GitHub releases 被墙。

**不在范围**：

- ❌ iOS（等 #10 远期，证书成本高）。
- ❌ 服务端推送通道（Web Push / FCM / APNs）——客户端轮询足够 P0 验证。

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
- **编码策略**（国内用户为重要使用场景）：读时自动嗅探 UTF-8 / UTF-8 BOM（自动剥）/ GBK / GB18030；写回统一 UTF-8 无 BOM；不可表示字符 → 弹"无法保存"明确错误，不静默吞漏。
- **不监听文件外部改动**：关闭时若检测到 mtime > 打开时 mtime → 弹「磁盘已变化」三选项（重新加载 / 保留我的修改 / 取消关闭）。

#### 11.7.4 三平台分发杠杆（顶级漏斗入口）

| 平台 | 注册机制 |
|---|---|
| Windows | WiX/MSI 安装程序注册 `.md` 默认打开程序（`HKCR\.md` + ProgID） |
| macOS | `Info.plist` 通过 `CFBundleDocumentTypes` + `UTExportedTypeDeclarations` 注册 `net.daringfireball.markdown` UTI |
| Linux | `.desktop` 文件 `MimeType=text/markdown;`（deb / AppImage 安装时打入） |

资源管理器 / Finder / Nautilus 双击 `.md` → weavine 以纯编辑器打开（无上传惊吓）→ 用爽后按需「导入库」。这是 web/Android 做不到的顶级漏斗入口。冷启动 argv 通过 `tauri-plugin-single-instance` 转发到首实例（避免双击闪退或开多进程）。

#### 11.7.5 文件大小策略

| 大小 | 编辑器态（打开/编辑/保存文件） | 「导入库」 |
|---|---|---|
| 任意大小 | **始终允许** | — |
| ≤ 1 MB | 正常 | ✅ 允许导入库 |
| > 1 MB | 正常（顶部轻量 banner） | ⛔ **置灰禁用**，提示「文件超过 1 MB，导入库会拖慢同步与备份」 |

> 编辑态不限制（只碰本地文件、不占云端）；「导入库」1 MB 阈值——避免单条 note 撑大 SQLite + 拖慢同步。

#### 11.7.6 编辑器 MVP UX

**做**：编辑/预览分屏、主题跟随系统设置、自动保存**关闭（避免悄悄写用户文件）、脏标记 + 未保存拦截、行号/查找替换/字数统计、编辑器态隐藏关系面板（避免干扰"只想写个字"的用户，导入后才出现关联能力）。

**不做**：协同编辑、AI 补全、Vim mode、表格可视化、宏、插件；wikilink `[[xxx]]` 解析（保留原文以备未来升级为可选功能）。

#### 11.7.7 导入即关联 + 导出闭环
- 「导入库」时弹 `EntityPicker`，并按正文 `@人名` 自动建议关联——把外来文件挂上关系网（weavine 相对 Typora / VS Code 的差异化）。
- 库内笔记支持「导出 `.md` 文件」回到磁盘形成闭环（数据可携）。导出文件**不含 frontmatter**——保留纯 markdown，未来若做双向同步可平滑升级。
- **重导入语义**（避免静默覆盖）：
  - 快速路径：文件 mtime ≤ `imported_at` → 自动跳过 + toast「已是最新」；
  - 冲突路径：文件 mtime > `imported_at` → 弹三选项（**更新已有笔记** / **跳过** / **作为新笔记导入**）。
- 导出 `.md` 时显式用 `setFileTimes` 把文件 mtime 设为 `imported_at`，让重导时走快速路径（若 FS 不支持改 mtime 则回退弹选择框）。

#### 11.7.8 最近文件（Recent files）
- 本地 LRU 10 条 `{path, last_opened_at}`，不跨设备同步（路径无意义）。

#### 11.7.9 数据模型（私有字段不上云）

- 桌面 SQLite `Note` 表新增 `imported_from TEXT` + `imported_at TEXT`——编辑器态导入的来源路径与时间留痕。
- 服务端 Postgres `note` 表**不加**这两列——本机路径上云泄露用户文件系统布局、跨设备无意义；sync translate 显式 drop。

#### 11.7.10 平台范围
- **本期范围**：Windows / Linux / macOS 三桌面端均支持 `.md` 编辑 + 导入库 + 导出 `.md` + 文件关联注册 + 最近文件。三平台共用同一编辑器实现，差异仅在 bundle 元数据。
- **不在本期**：Web、移动端（库内已存在的笔记在 web/移动端已有能力可查看）。

#### 11.7.11 不在范围（明确）
- 不做"保存双写文件+库"——彻底规避双副本分歧。
- 不把外部文件路径纳入云端同步（`imported_from` 在 server drop）。
- 不做协同编辑、外部编辑器插件、AI 补全、Vim mode、表格可视化。
- 不支持 `.markdown` / `.mdown` / `.mkd` 等扩展名变体（仅 `.md`，覆盖 99% 用例；变体可后续再加）。

#### 11.7.12 OS 文件关联扩展到 docx / pdf / txt / html / htm / xlsx / pptx（v1.3.10，commit `86cb08c` / tag `v1.3.10`）

**需求**：§11.7 v1.3.6/v1.3.7 仅把 `.md` 注册为 OS 文件关联格式（Windows WiX ProgID / macOS `Info.plist` UTI / Linux `.desktop` MimeType）。本期扩展关联范围到 `md / docx / pdf / txt / html / htm / xlsx / pptx` 共 7 种——weavine 已能通过 `convert_external_file` 把后 6 类转 Markdown 编辑，OS 双击或「打开方式」应能找到并启动 weavine（漏斗断点：用户先开 weavine 再从应用内"打开文件"对话框）。

**拍板**：三平台（Windows / macOS / Linux）统一通过 `tauri.conf.json::bundle.fileAssociations` + `tauri-plugin-single-instance` 处理 argv；前端契约不变（`open-md-from-argv` 事件、`take_pending_md_path` 命令、`MdEditor` 转换流程），零前端改动；扩展名清单在 Rust 侧有单一真相源（`lib.rs::is_supported_argv`），与 `fileAssociations` 强同步。

**不在范围**：移动端 / Web 的 OS 关联；新增更多格式（`.epub` `.rtf` `.odt` 等）——等用户需要再加。

---

#### 11.7.13 转换崩溃根治：独立进程隔离（sidecar，修复 v1.3.10 仍崩溃）

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
