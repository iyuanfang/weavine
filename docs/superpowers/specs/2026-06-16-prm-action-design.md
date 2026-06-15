# PRM v2.1 — Action-Centered Redesign

> **For agentic workers:** Skip — this is a product design spec for the user, not an implementation plan. After user approval, run `superpowers:writing-plans` to create the implementation plan.

**Goal:** Unify Tasks, Needs, and Interactions under a single `Action` entity so PRM becomes the only place where "what I need to do" and "who I need to do it with/around" live together. Differentiate on **hybrid people + action** — the gap in the market.

**Background:** This supersedes §3 "竞品对标" and §5 "v2 功能清单" in `2026-06-15-prm-v2-design.md` for the Action-related sections. P0/P1/P2 features unrelated to Actions (OCR, 农历, 礼金, 群关系) remain valid.

---

## §1 洞察 — 任务不该漂浮在空气里

### 1.1 现状问题
传统 todo 工具的根本缺陷：**任务脱离"为什么"**。你写下"周三前发合同给李四"，但你**不知道为什么**——是他在催你？是你答应过？是你欠他人情？

传统 CRM 的根本缺陷：**联系人脱离"做什么"**。你记录了李四的所有信息，但不知道你**今天/这周该不该主动联系他**、上次聊了什么、下次该聊什么。

**真相**：人和事是缠绕的。任务经常是"为了某人的事"，联系人的维护经常是"要做的事"。

### 1.2 竞品 gap
调研了 8 个产品（Lunatask, Tana, Monica, Dex, Clay, Mesh, Notion, GTD）：

- **Todoist / Things / TickTick**：任务一等公民，**联系人没有**或很弱
- **飞书 / 钉钉 / 企微**：任务 OK，通讯录 OK，**任务不绑人**（"完成"按钮点完就忘了"为什么做"）
- **Lunatask**（最接近）：任务+习惯+笔记+关系都一等公民，**双向深链**，但「今日联系人」视图是弱提示，不是主流
- **Tana**：数据模型最强（Supertag / 一切是对象），**但要自己搭视图**，普通用户门槛极高
- **Monica / Clay / Dex / Mesh**：联系人一等公民，**任务系统弱或没有**

**结论**：没有任何产品把"人 + 任务"做平等的一等公民 + 统一的"今天"视图。这是一个**真实可占据的生态位**。

### 1.3 GTD × CRM 的天然契合
David Allen 的 GTD 有两个被严重低估的概念：
- **"Waiting For" 列表** — 你在等张三回复提案。等的人就是联系人
- **"Agenda: [Person]"** — 下次见张三要聊的 5 件事。人就是清单的根

Allen 本人没把这两个做进软件（GTD 软件是任务为中心的），但**这两个概念天然就是 CRM 的核心**。PRM 是天然容器。

---

## §2 核心设计：Action 三态

把所有"要做事"统一成 `Action` 实体，三种"为什么"用三个状态区分：

| 状态 | 含义 | 举例 |
|---|---|---|
| `inbox` | 刚捕获，还没处理 | "周三发合同给李四" |
| `open` | 已明确，下一步可执行 | 独立任务或 1:1 要做的 |
| `waiting` | 等别人的回复/动作 | "等张三回复合同条款" |
| `done` | 已完成（保留 30 天回看） | — |
| `dropped` | 不做了 | — |

**关键变化**：**没有 `matched` / `in_progress` / `closed` 这些 CRM 化的状态**。那是"对外合作"的视角，不是"我自己要做的事"的视角。新设计把"找前端工程师"这种 need 看作一个**持续 open 的 Action**（不是"流程阶段"），匹配到人之后依然 open（因为人找到了，**但要做的事没做**——比如"约咖啡谈合作"才是要做的 action）。

### 2.1 Action 字段

```prisma
model Action {
  id          String   @id @default(cuid())
  title       String
  description String?
  status      String   @default("inbox")   // inbox|open|waiting|done|dropped
  priority    Int      @default(0)         // 0-10
  category    String?                       // 灵活：交流/合作/学习/健康/其他
  dueAt       DateTime?                    // ⭐ 关键字段：今天/明天/这周
  contactId   String?                       // ⭐ 关联人（可选，核心字段）
  waitingOnId String?                       // ⭐ "Waiting For"：在等谁
  eventId     String?                       // ⭐ 关联到日程项（见 §2.3）
  recurring   String?                       // cron expr (P1)
  completedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  contact     Contact?  @relation(fields: [contactId], references: [id], onDelete: SetNull)
  waitingOn   Contact?  @relation("WaitingOn", fields: [waitingOnId], references: [id], onDelete: SetNull)
  event       Event?    @relation(fields: [eventId], references: [id], onDelete: SetNull)
  @@index([status, dueAt])
  @@index([contactId])
  @@index([waitingOnId])
}
```

### 2.2 三个一等视图

#### 视图 A：今日（Today）— 首页核心

```
┌────────────────────────────────────────┐
│ 今天 · 周三 6/16                        │
│                                        │
│ ⏰ 今天 (3)                            │
│ ├─ [P5] 9:00 发合同给李四       [李四] │
│ ├─ [P3] 14:00 写完周报                  │
│ └─ [P7] 17:00 约张三次周咖啡  [张三]    │
│                                        │
│ 📅 即将到期 (2)                         │
│ ├─ [P5] 周五 · 提交投资提案            │
│ └─ [P3] 周日 · 回电话给王五   [王五]    │
│                                        │
│ ⏳ 等待回复 (3) · 超过 7 天的标红        │
│ ├─ 12天前 · 等李四回复合同     [李四] │
│ ├─ 5天前 · 等张三介绍投资人    [张三] │
│ └─ 3天前 · 等王五简历          [王五]  │
│                                        │
│ 👥 今天该联系 (1) · 90 天未联系        │
│ └─ 92 天前 · 赵六             [赵六]  │
└────────────────────────────────────────┘
```

#### 视图 B：看板（Kanban）— 保留，状态列改名

```
[收件箱 Inbox (5)] → [待办 Open (8)] → [等待中 Waiting (3)] → [已完成 Done (今日 2)]
```

拖拽逻辑：
- inbox → open：已明确，可以做
- inbox → waiting：明确要等某人
- inbox → dropped：不做了
- open → waiting：卡住了，等某人
- waiting → open：等的人回复了，继续
- open → done：完成
- 任何 → dropped：放弃

#### 视图 C：按人（By Person）— 差异化核心

`/contacts/[id]` 页加一个 tab：**"行动"**，显示跟这个人相关的所有 action：
- **我答应他的**（contactId = 他）
- **他在等我的**（waitingOnId = 他）
- **他欠我的**（反向：从他的 open Actions 看他答应我的 — 这个需要新字段，先不做）
- **和他有关的 event**（已有）
- **和他的 interaction 时间线**（已有）

**这是市场空白**：没有任何 CRM 让你以"人"为入口看到所有跟他有关的事。

### 2.3 Event ↔ Action 双向连接

v1 已有 Event。v2.1 把 Event 当成 Action 的一种"时间锚点"：
- **创建 Event 时可以勾选"创建后续 Action"**（例：约了张三 6/19 14:00 见面，自动创建 action "19号见面前：准备上次的讨论提纲"，dueAt = event startAt - 1day, contactId = 张三）
- **Action 详情显示关联的 Event**（如有）
- 日历视图可叠加显示 Action（淡色背景 / 标记）

**这是天然的"会面前 checklist"**。

---

## §3 数据迁移：Need → Action

### 3.1 迁移策略
- 新建 `Action` 表，**保留 `Need` 表** 30 天做只读归档
- 数据迁移脚本：把每条 Need 转为 Action
  - `status: open → Action.status: open`（或 waiting，看 contactId）
  - `status: matched → Action.status: open, contactId = Need.contactId`（匹配到了人，**人找到了，要做的事没做**）
  - `status: in_progress → Action.status: open`
  - `status: closed → Action.status: done, completedAt = closedAt`
  - `status: cancelled → Action.status: dropped`

### 3.2 UI 改名
**逐步迁移**，避免一次性 break：
1. **第一阶段**：UI 引入 Action 概念，但底层还是 Need 表。/actions 路由 = /needs 路由别名。状态术语更新（"matched" → "open with contact"）
2. **第二阶段**：迁移数据到新 Action 表，旧 Need 表下线
3. **第三阶段**：彻底删除 Need 路由

### 3.3 不破坏现有
- Event / Interaction / Reminder / InboxItem / Contact / Tag — **全部不动**
- 仅 Need 模型进化为 Action
- Cron 任务保持运行（stale 提醒逻辑改用 Action 替代 Need）

---

## §4 实施分阶段

### 阶段 1：Action 数据模型 + 服务（2-3h）
- Prisma 加 `Action` 表（与 `Need` 共存）
- `ActionService`（从 `NeedService` 复制+改名+改 status enum）
- `/api/actions/*` REST 端点（供 Today 视图用）
- **不改 UI，不破坏 v1**

### 阶段 2：Today 视图 + 看板升级（3-4h）
- 新路由 `/today` 重新设计首页
- `ActionService.today()` 返回三个分组（今天/即将到期/等待回复）
- `ActionService.byContact(id)` 返回按人视图
- `/needs` 看板升级：状态列改名 + 加 dueAt 排序 + 等待列表加超时颜色
- 联系人详情页加 "行动" tab

### 阶段 3：Event ↔ Action 联动（2h）
- 创建 Event 表单加 "创建后续 Action" 复选框 + dueAt 偏移
- Event 详情页加 "关联 Actions" 区块
- Action 详情页加 "关联 Event" 区块

### 阶段 4：迁移 Need → Action + 清理（1-2h）
- 数据迁移脚本
- 路由别名 /needs → /actions
- 30 天后删除 Need 表

---

## §5 与 v2 其他功能的关系

**v2 P0/P1/P2 中不冲突的（继续做）**：
- 名片 OCR（联系人创建流程）
- 农历节日（生日提醒）
- 群关系（联系人关系图）
- 礼金（Interaction 扩展）
- WeTrace 导入（联系人批量导入）

**v2 中被 Action 取代或调整的**：
- ~~"找前端工程师" need 看板~~ → Action 长期 open，可关联 contact
- ~~Need kanban "matched" 状态~~ → Action 状态只有 inbox/open/waiting/done/dropped
- "Stale 提醒" cron → 改用 Action 的 dueAt 触发

**v2 中新增的（Action 中心化后更强）**：
- 微信聊天记录 → 提取"答应某人要做的事" → 自动创建 Action，waitingOn=某人
- 共同好友图谱 → 在两人共同好友页面显示"和这两人相关的所有 Action"

---

## §6 UI/UX 原则

### 6.1 一行原则
**Action 列表项永远只显示一行**：标题（最重）+ dueAt 徽章 + 关联人头像 + 状态徽章。详情展开/独立页。

```
[周三] 9:00 [P5] 发合同给李四         [李四头像] → 打开查看
```

### 6.2 时间即颜色
- 红色：已过期
- 橙色：今天
- 黄色：未来 3 天
- 灰色：3 天后
- 暗红字：waiting 超过 7 天

### 6.3 双击 = 状态切换
- inbox → open（双击）
- open → done（双击）
- 任何状态 → 右键菜单（移到 waiting/dropped/编辑/删除）

### 6.4 创建极简
- 全局 `⌘N` 调出 quick capture modal
- 只填标题（必填），其他全部默认 + Tab 切换
- 解析 `周三` `明天` `下周一` `P5` `@张三` `#工作` 这种自然语言（v3）

---

## §7 验收标准（v2.1）

1. ✅ `/today` 显示今天 + 即将到期 + 等待回复 + 该联系的人
2. ✅ `/actions` 看板拖拽改状态，所有状态转换正确
3. ✅ 联系人详情页能看到"行动"tab，含我答应他的 + 他在等我的
4. ✅ 创建 Event 时勾选"创建后续 Action"能自动生成 dueAt = event - 1day 的 action
5. ✅ 旧 Need 数据完整迁移，URL 别名 `/needs` 仍可访问
6. ✅ Waiting 超过 7 天的 action 在 Today 视图标红
7. ✅ ⌘K quick capture 调出，标题必填，其他可空
8. ✅ 全部现有 43 个测试通过
9. ✅ `pnpm build` clean

---

## §8 不做（v2.1 范围外）

- 番茄钟 / 专注模式
- 重复任务 UI（schema 预留 `recurring` 字段，UI P1）
- 自然语言日期解析（v3）
- Action 模板 / 共享（单人工具，不需要）
- 移动端原生 app（web PWA 优先）
- GTD 完整实现（contexts, projects 等高级 GTD 概念 — v3 评估）

---

## §9 风险 + 决策

| 风险 | 决策 |
|---|---|
| 数据迁移丢数据 | 保留 Need 表 30 天，迁移脚本幂等可重跑 |
| UI 改状态术语用户不适应 | 阶段 1 同步显示新旧术语，逐渐淡化 |
| Today 视图没数据时像空白 | Dashboard fallback：即使没 action，也显示 + 引导创建第一个 |
| 看板和 Today 视图数据重复 | 看板是"wide"，Today 是"narrow"，定位不同。文档里讲清 |
| Action 数量爆炸 | 软上限提醒（100/500/1000）+ 归档 dropped 到年度视图 |

---

## §10 一句话价值主张

> **PRM v2.1：不是另一个 todo app，不是另一个 CRM。** 是**你为人和人之间的事**留的**唯一清单**。

任务有"为什么"（for whom）。
联系人有"下一步"（what next）。
事件有"前后"（before / after）。
时间有"该做什么"（today / waiting / overdue）。

这四件事在一个 view 里。
