# 新版 Weavine 发布：本地优先 + 多端同步，一份真正属于你的人脉操作系统

> 一份写给销售、OPC、HR、自由职业者的开源 PRM
> 微信 ID: weavine-prm · v0.2.23 · 2026-07

---

## 写在前面

你手机里存着 800 个微信好友，Excel 里有 600 个客户跟进记录，备忘录里零星记着和某某总吃饭的时间。LinkedIn 改了 API，那些靠抓数据做 CRM 的 SaaS 工具瞬间贬值；Salesforce 一年几万块，但你只想要一个不会跑路、能离线打开、能把数据握在自己手里的工具。

这正是 Weavine 在做的事：**本地优先 (local-first) + 多端同步 + 完全开源** 的人脉管理工具。今天这篇推文，把新版 v0.2.23 的架构选择、sync 引擎、核心功能、适用场景一次性讲透。

---

## 一、为什么是 Tauri + Rust，而不是 Electron 或纯 Web？

市面上的桌面应用，99% 是 Electron 写的：VSCode、Slack、Notion、本地版 Figma 都是。Electron 的优势是开发快，代价是——

| 维度 | Electron | Tauri + Rust |
| --- | --- | --- |
| 安装包体积 | 150-300 MB | **30-65 MB**（Weavine 65MB） |
| 内存占用 | 一个 tab 200MB+ | 同等场景 80MB |
| 后端能力 | Node.js（要装运行时） | **Rust 编译进二进制，零依赖** |
| 跨平台 UI | Chromium | 系统原生 WebView |
| 安全模型 | 进程隔离 | Rust 内存安全 + Tauri allowlist |

Weavine v0.2.23 的桌面包体积：

- macOS：6.9 MB DMG
- Windows：7.9 MB MSI
- Linux：6.9 MB DEB
- Android：64.6 MB APK（含 4 个 ABI 的原生库）

**一个 SQLite 文件 (`weavine.db`)，一份 Rust 业务逻辑 (`src-tauri/src/business/`)，一套 React 组件 (`apps/web-spa/`)，三端共用。** 这就是 Tauri 的魅力：Rust 干 Rust 该干的事（数据库、文件、HTTP、同步引擎），Web 干 Web 该干的事（界面、交互、可视化），中间用 Tauri 的 IPC 桥接，性能和体验双赢。

更关键的是**安全模型**：Tauri 默认开启 `withGlobalTauri: false`、能力白名单、严格的 CSP。我们的 sync 引擎不会因为网页里的某段 JS 误调用就往文件系统写垃圾——所有 `INSERT / UPDATE / DELETE` 只能从 Rust 侧发起。

---

## 二、多端同步：像 Git 一样可靠的 revision 模型

新版最大的工程量，都在 sync v0.2.0b。

### 2.1 双栈架构

- **桌面端** (`src-tauri/`)：单用户，本地 SQLite，rusqlite 直接查询 `business/` 模块
- **云端** (`server/`)：多用户，PostgreSQL + sqlx 0.8，handlers 直接拼 `sqlx::query`
- **共享层**：只有 `weavine_lib::models` 的结构体和 `#[derive(sqlx::FromRow)]` 标注

为什么不抽象一个 `trait Repo`？因为 sync v0.2 的 schema 还在演化——列重命名、新增 `server_revision`、新增 `deleted_at`、给 `contact_tag` 加 `id` PK。提前抽象意味着反复重写。等 schema 稳定到 v0.2.0c 再统一。

### 2.2 server_revision 序列号

每张业务表多了一列：

```sql
server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq')
deleted_at      TEXT    -- 软删除标记
```

每次 `INSERT / UPDATE / DELETE`，PostgreSQL 的 11 个 trigger 自动往 `sync_change_log` 表里塞一条记录：

```text
{ table: 'contact', row_id: '...', op: 'update',
  rev: 12345, payload: {...}, device_id: '...' }
```

桌面端启动时拉 `WHERE rev > last_seen_rev` 的差量，离线期间所有改动暂存本地队列，重连后批量上传。

### 2.3 冲突解决

桌面端每条记录带 `local_modified_at` + `last_synced_rev`；服务端是 source of truth，采用 **last-write-wins on server_revision**。这个策略对人脉场景足够：联系人资料的"最后修改"通常就是最新事实，不存在多人协同编辑同一字段的并发问题。

### 2.4 真正的离线优先

关掉网络，打开 Weavine，所有功能照常用：搜索、添加联系人、记日程、设提醒。WebView + SQLite + Rust 都在本地。网络只是 sync 的副产物，**不是功能的前提**。

---

## 三、核心功能：覆盖一个销售的全部日常

### 3.1 联系人 (Contact)

不只是姓名+手机+邮箱——

- 多维度属性：姓名、公司、职位、来源渠道、关系强度、最后联系时间
- **标签系统** (Tag)：可任意组合，例如「VIP」「决策人」「上海」「2024 展会」
- **关联项目** (ProjectContact)：一个联系人可参与多个项目，反向追溯
- **互动时间线** (Interaction)：每次见面的纪要自动归档
- **搜索**：姓名 / 公司 / 标签 / 备注，SQL `LIKE` 查询秒级返回（小数据量够用，大数据量将升级到 SQLite FTS5）

### 3.2 项目 (Project)

- 项目阶段、起止时间、所属客户
- 关联多个联系人（区分"决策人"、"经办人"、"外部顾问"）
- 项目归档 7 天后自动进入 Archive

### 3.3 待办 (Action) + 日程 (Event)

- 待办：标题、截止时间、优先级、所属联系人/项目
- 日程：起止时间必填（end 默认 start + 1h，避免出现"无时长"的日程）
- **自动归档**：完成超过 1 天的待办 / 已结束的日程，自动进 Archive，不打扰主视图
- Archive 页可一键恢复最近 30 天的全部归档

---

## 四、谁应该用 Weavine？

### 4.1 To B 销售 / 销售经理

**典型场景**：你手头 200 个客户，分布在 30 个项目里，每周一开例会要复盘跟进节奏。

Weavine 给你的：联系人 + 项目 + 互动时间线 三表联动，看一眼就知道"张总已经 23 天没联系了"。在桌面录完，手机端打开就是最新数据（v0.2.23 已支持 Android，下载在文末）。

### 4.2 OPC / 一人公司 / 独立创业者

**典型场景**：你一个人要管客户、合伙人、供应商、投资人、潜在候选人。

Weavine 给你的：标签 + 备注 + 互动纪要，把所有人脉当作"公司资产"来管理。本地优先意味着——你换电脑、换公司、换城市，数据库跟着 U 盘走。**没有 SaaS 跑路、没有月费、没有数据被广告化的风险。**

### 4.3 HR / 猎头 / 招聘官

**典型场景**：活跃候选人池 2000+，分行业、职级、阶段，季度回访一次。

Weavine 给你的：标签 + 搜索 + 互动时间线，候选人"变冷"自动提示。A 轮候选人半年没联系了？时间线一眼看到。

### 4.4 自由职业者 / 顾问 / 设计师

**典型场景**：5-10 个长期客户，每月一次 review，每个项目 3-5 个干系人。

Weavine 给你的：项目维度组织联系人，比通用 CRM 轻 10 倍，比 Excel 强 100 倍。

### 4.5 学术研究者 / 博士生 / 投资经理

**典型场景**：合作者网络 200-500 人，需要按"研究方向 / 合作阶段 / 最近互动"分类。

Weavine 给你的：自定义标签 + 搜索 + 时间线，比 ReadCube / EndNote 联系人模块更自由。

### 4.6 任何"微信好友爆炸"的人

如果你的微信好友过 1000，但能叫出名字的不到 200——**Weavine 是你的微信好友档案系统**。每周花 10 分钟把新加的人录入，半年后你会感谢自己。

---

## 五、和 SaaS / 竞品对比

| 维度 | 商业 SaaS (Dex/Clay/Folk) | Monica 等开源 PRM | **Weavine** |
| --- | --- | --- | --- |
| 月费 | $10-40 | 免费（自托管） | **免费 + 可自托管** |
| 数据所有权 | 厂商服务器 | 自托管 | **本地优先，可选云同步** |
| LinkedIn 依赖 | 强（API 收紧后崩） | 无 | **无** |
| 多端同步 | ✅ 闭源 | ⚠️ 仅 Web | **桌面 + Android + Web** |
| 中文本地化 | ❌ | ❌ | **✅** |
| 包体积 | N/A | Docker 部署 | **65 MB 单文件** |
| 技术栈 | 闭源 | PHP / Python | **Rust + React，开源可审计** |

详细竞品分析见仓库 `同类产品深度调研报告.md`。

---

## 六、技术栈速览

```
src-tauri/          Rust 后端 + Tauri 桌面运行时
├── src/
│   ├── business/   业务逻辑（联系人/项目/同步）
│   ├── db/         rusqlite + migration.rs (SCHEMA_SQL)
│   ├── sync/       sync v0.2.0b 引擎
│   └── tauri/      commands + 事件桥接
└── gen/android/    Android 工程（gitignore）

apps/web-spa/       React 18 + Vite + Tailwind 前端
├── src/routes/     按 URL 一文件一页面（按需增加，不为"功能看起来全"凑数）
├── src/components/ 复用 UI 原语
└── public/         PWA 资源（manifest.json / sw.js）

server/             weavine-server (云端同步)
├── migrations/     0001-0004 schema 演进
├── src/handlers/   axum + sqlx
└── Dockerfile      postgres + 服务端
```

**完全开源，AGPL-3.0**（确保改进回馈社区）。Rust 写后端 + 同步引擎，TypeScript 写前端——两种语言各管一段，没有共享运行时拖累。

---

## 七、如何开始

### 桌面（推荐先体验）

```bash
git clone https://github.com/iyuanfang/weavine
cd weavine
pnpm install
pnpm tauri dev          # 全栈开发模式
```

或直接下载 Release：

- macOS：`Weavine_0.1.8_aarch64.dmg` (6.9 MB)
- Windows：`Weavine_0.1.8_x64_en-US.msi` (7.9 MB)
- Linux：`Weavine_0.1.8_amd64.deb` (6.9 MB)

### Android

[GitHub Releases](https://github.com/iyuanfang/weavine/releases/tag/v0.2.23) 下载 `Weavine_universal-release.apk` (64.6 MB)，覆盖 4 个 ABI（arm64-v8a / armeabi-v7a / x86 / x86_64）。需开启"未知来源安装"。

### Web

直接访问 [https://weavine.financialagent.cc/](https://weavine.financialagent.cc/) 即可使用——浏览器里跑的是和桌面端同一份 `apps/web-spa` 代码，数据走同一套 `weavine-server` 同步引擎。无需安装，但需要注册账号。

### 即将支持

- **iOS**：Tauri v2 已支持 iOS，CI 适配进行中

---

## 八、Roadmap（v0.3+）

- [ ] 关系图谱可视化（D3 force-directed graph）——"我的合作者网络长啥样"
- [ ] AI 自然语言录入（"我昨天和张三吃饭，他换了新工作" → 自动拆出 Contact + Event + Interaction）
- [ ] 关系健康评分（基于最近互动频次/历史活跃度）
- [ ] 团队多用户版（基于云端 sync，多人协作编辑同一联系人）

---

## 九、写在最后

人脉管理这件事的本质，不是工具，是**习惯**。任何 CRM 用不起来，都是因为"录入成本 > 回顾收益"。

Weavine 想做的是那个**录入成本足够低、离线可用、数据永远属于你**的底座。剩下的，是每周 10 分钟的"关系维护时间"。

如果你也是：
- 被 Excel / 微信 / 备忘录搞烦了的人
- 对 SaaS 数据安全和厂商绑定敏感的人
- 想找一个能跑 5-10 年的开源工具的人

欢迎 Star、Fork、提 Issue、PR。

🔗 **GitHub**: https://github.com/iyuanfang/weavine
📦 **下载**: https://github.com/iyuanfang/weavine/releases
💬 **社区**: 微信群（文末二维码）/ GitHub Discussions
📖 **文档**: 仓库 `docs/` + `同类产品深度调研报告.md`

---

如果这篇文章对你有帮助，请点个**在看**、**转发**给身边那个"联系人管理一团糟"的朋友。

你的支持，是开源项目最大的燃料。🪴

---

*本文基于 Weavine v0.2.23 (2026-07-06)，所有功能以仓库 main 分支为准。*
