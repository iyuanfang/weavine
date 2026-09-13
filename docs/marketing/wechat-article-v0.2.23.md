# 新版 Weavine 发布：本地优先 + 多端同步，一份真正属于你的人脉操作系统

> 一份写给销售、OPC、HR、自由职业者的开源 PRM
> 微信 ID: weavine-prm · v0.2.23 · 2026-07

---

## 写在前面

你手机里存着 800 个微信好友，Excel 里有 600 个客户跟进记录，备忘录里零星记着和某某总吃饭的时间。LinkedIn 改了 API，那些靠抓数据做 CRM 的 SaaS 工具瞬间贬值；Salesforce 一年几万块，但你只想要一个不会跑路、能离线打开、能把数据握在自己手里的工具。

这正是 Weavine 在做的事：**本地优先 (local-first) + 多端同步 + 完全开源** 的人脉管理工具。今天这篇推文，把新版 v0.2.23 的核心功能、适用场景、和当下可用情况一次性讲透。

---

## 为什么本地优先：你的联系人数据，必须握在你手里

很多人装联系人管理工具，第一个担心就是：**我的客户数据会不会被厂商拿走？会不会被拿去训练 AI？会不会有一天 SaaS 跑路我找不到备份？**

Weavine 的答案很简单：你的数据从一开始就在你电脑上，不在任何人的服务器上。

- **桌面端**：联系人数据存在一个 SQLite 文件（`weavine.db`），就在你电脑的用户目录里。你可以 `cp` 它、`rsync` 它、塞进 U 盘带走、丢进 Time Machine / 坚果云备份——任何时候都看得见，能直接用 SQLite 工具打开看。
- **云端同步是可选的**：不跑 `weavine-server`，数据完全不出本机。装哪个端都不会自动上传任何东西。我们不会因为"Web 版方便"就把你的数据偷偷同步到我们控制的服务器。
- **真要同步**：你自己跑 `weavine-server`（Docker / VPS / NAS 都行），数据走的是**你自己的基础设施**，不经过任何第三方。
- **代码全开源**（AGPL-3.0）：如果某个 build 偷偷做了什么你看不出来的事，自己 build 一份二进制解包验证。Tauri 的 IPC 桥、SQLite 的写入路径、所有 Rust 业务代码都在 `src-tauri/src/business/` 下，欢迎审计。
- **AGPL 的网络条款**：就算有人 fork 出 Weavine 改一改当 SaaS 卖，他必须把改动开源——确保你的隐私工具不会突然变成别人的"数据收集器"。

我们不是反对云服务——很多人需要多端协同，Weavine 提供 sync 方案。但 sync 服务**由你自己掌控**，不是默认开启、不是后台静默跑、是显式的 opt-in。

---

## 当前可用状态（2026-07-06）

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| **Windows** | ✅ 可用 | 下载 v0.2.24 MSI 直接装，所有功能正常 |
| **Linux** | ✅ 可用 | 下载 v0.2.24 DEB 直接装，所有功能正常 |
| **Web** | ✅ 可用 | 直接访问 [weavine.financialagent.cc](https://weavine.financialagent.cc/) 即可用 |
| **macOS** | ⚠️ 暂未确认 | v0.2.24 DMG 还没在 macOS 实机上完整跑过，建议先在 Web / Windows / Linux 端用 |
| **Android** | ⚠️ 安装后白屏 | 已知 bug，WebView 加载 APK assets 时 `assetProtocol` 没启用，所有静态资源 404。修复方案已定位，等打完包验证就 tag v0.2.25 |

**实用建议**：如果你急着要用，先在 Windows / Linux / Web 任何一个端开始存联系人——多端同步（`weavine-server`，可选）会让数据跨端打通。也可以先把要联系的客户 / 项目录到 Web 端，等 Android 修好了再装回来，所有数据会自动 sync 过去。

**多端同步是可选的**。单端完全够用：你只是想要一个能离线打开、数据在自己手里的工具，Weavine 就是。

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

Weavine 给你的：联系人 + 项目 + 互动时间线 三表联动，看一眼就知道"张总已经 23 天没联系了"。在桌面录完，手机端打开就是最新数据（多端同步打开后自动 sync）。

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
| 多端 | ✅ 闭源 | ⚠️ 仅 Web | **桌面 + Web（Android 修复中）** |
| 中文本地化 | ❌ | ❌ | **✅** |
| 包体积 | N/A | Docker 部署 | **65 MB 单文件** |
| 技术栈 | 闭源 | PHP / Python | **Rust + React，开源可审计** |

详细竞品分析见仓库 `同类产品深度调研报告.md`。

---

## 七、如何开始

### Windows / Linux（推荐先体验）

下载 [GitHub Releases v0.2.24](https://github.com/iyuanfang/weavine/releases/tag/v0.2.24) 的 MSI / DEB 直接装。首次启动会在用户目录建一个 SQLite 文件（`weavine.db`），所有数据落在本地。

### Web

直接访问 [https://weavine.financialagent.cc/](https://weavine.financialagent.cc/) 即可使用——浏览器里跑的是和桌面端同一份 `apps/web-spa` 代码，数据走同一套 `weavine-server` 同步引擎。无需安装。

### Android / macOS

⚠️ 这两个端的 v0.2.24 还有白屏 bug（详见上文「当前可用状态」）。如果你急着要，建议先在 Web / Windows / Linux 用；修复 PR 已就绪，预计 v0.2.25 上线。

### 多端同步（可选）

不需要 sync server 也能用——单端本地完全够用。

想多端 sync 的话：跑一个 `weavine-server`（单二进制 + Postgres），把所有端指向同一个账号即可。Dockerfile 在 `server/Dockerfile`。

### 开发者：从源码跑

```bash
git clone https://github.com/iyuanfang/weavine
cd weavine
pnpm install
pnpm tauri dev          # 全栈开发模式（桌面）
pnpm --dir apps/web-spa dev   # 仅 Web（前端 Vite dev server）
```

---

## 八、Roadmap（v0.3+）

近期待做（已排期）：

- [ ] **Android 白屏修复** → v0.2.25（`assetProtocol` enable + 重新打 universal APK）
- [ ] **macOS 真机验证** → v0.2.25（在用户的 Mac 上完整跑一遍）
- [ ] **关系图谱可视化**（D3 force-directed graph）——"我的合作者网络长啥样"
- [ ] **AI 自然语言录入**（"我昨天和张三吃饭，他换了新工作" → 自动拆出 Contact + Event + Interaction）

更长远的想法：

- 关系健康评分（基于最近互动频次/历史活跃度）
- iOS build（Tauri 2 已支持 iOS，CI 适配进行中）

明确不做：

- 团队多用户版 / 共享 workspace——Weavine 定位是 **PRM**（个人人脉管理），不是 CRM。一个人的工具，不是给团队用的 SaaS。

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

如果你这篇文章对你有帮助，请点个**在看**、**转发**给身边那个"联系人管理一团糟"的朋友。

你的支持，是开源项目最大的燃料。🪴

---

*本文基于 Weavine v0.2.23 (2026-07-06)，所有功能以仓库 main 分支为准。*

---

## 附录：技术细节（可选阅读）

> 下面这几节是给开发者 / 想了解架构的读者准备的。如果你只是想用 Weavine，看完前面就够了。

### 六、技术栈速览

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