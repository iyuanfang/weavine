# PRM 时间线重构设计

> 将 Action / Interaction / Event 统一为一条时间线，去掉重复概念，打通转化。

## 核心原则

1. **只改 3 个概念，不新增**：Action（有待办状态）、Interaction（记录/结果）、Event（日程）
2. **去冗余**：去掉 `waitingOnId`，用 `contactId` + `status=waiting` 表达
3. **打通转化**：每条记录都可一键转为 Action/Event，Action 完成自动写结果

## 数据模型变更

### Action（简化）

```prisma
model Action {
  id          String   @id @default(cuid())
  title       String
  description String?
  status      String   @default("inbox")  // inbox → open | waiting → done | dropped
  priority    Int      @default(0)
  category    String?
  dueAt       DateTime?
  contactId   String?  // 关联的人（null = 纯想法/个人待办）
  contact     Contact? @relation("ActionForContact", ...)
  eventId     String?  // 关联的日程
  event       Event?   @relation("ActionForEvent", ...)
  completedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**移除：** `waitingOnId`, `waitingOn` relation
**认知模型：** `status=open` = 我要做, `status=waiting` = 等对方（contact 就是等谁）

### Interaction（增加关联 Action）

```prisma
model Interaction {
  id         String   @id @default(cuid())
  contactId  String?  // null = 纯想法
  contact    Contact? @relation(...)
  actionId   String?  // 关联的 Action（Action 完成写结果时填入）
  action     Action?  @relation("InteractionFromAction")
  eventId    String?  // 关联的日程
  event      Event?   @relation("InteractionFromEvent")
  occurredAt DateTime
  channel    String?  // 渠道 / "思考"（纯想法）
  summary    String
  createdAt  DateTime @default(now())
}
```

**新增：** `contactId` 改为可选，增加 `actionId`, `eventId` 关联
**新增索引：** `@@index([occurredAt])`

### Event（不变）

保持现有结构，不修改。

## 导航布局

```
主导航：今天 | 联系人 | 日程 | Action
```

Action 不合并到日程——它有独立的工作流（status stage），和日历不同。

## /today 统一时间线

混排三种条目，按时间倒序：

```
📅 14:00 和张三聊方案                    ← 今天的日程
☑ P1 准备张三 meeting agenda（今天截止）  ← 今天到期的 Action
☑ P2 回复李四的报价邮件（已过期！）       ← 过期的 Action 标红
──────────────────────
📝 跟张三聊了方案，确认下周三开会         ← 最近的 Interaction
📝 王五确认合作意向                       ← 最近的 Interaction
```

- Action 按到期排序（过期优先 > 今天 > 未来）
- Interaction 显示最近 7 天
- 每条可点进详情 / 快捷操作

## ⌘K 统一捕捉

一条输入，自然语言解析自动判断类型：

| 输入 | 识别为 | 说明 |
|------|--------|------|
| 跟张三聊了方案 | Interaction | 过去时 |
| 明天交方案 | Action | 含到期时间 |
| 明天下午3点和张三开会 | Event | 含具体时间 |
| 整理客户分类 | Action（无联系人） | 纯想法 |

自动分类规则（简化版）：
1. 包含具体时间段（明天下午3点、周三）→ Event
2. 包含"交、做、准备、跟进、回复"等 → Action
3. 包含"聊、说、沟通、确认"等过去词 → Interaction
4. 均无法识别 → Action（可手动切换）

## 联系人详情：统一时间线

一个 tab 混排该联系人的全部内容：

```
张三 · 时间线
═══════════════════
📅 明天 14:00 和张三聊方案
☑ P1 跟进定价确认（open）
────────────────────
📝 微信：他说方案已看，约了周三聊
☑ 完成 发送方案给张三
────────────────────
📝 线下：饭局认识，聊了合作
```

不需要切 tab，一条时间线看完所有交集。

## 转化路径

| 操作 | 入口 | 结果 |
|------|------|------|
| 记录 → 待办 | Interaction 详情：「创建待办」 | 新 Action，关联此 Interaction |
| 记录 → 日程 | Interaction 详情：「创建日程」 | 新 Event，关联此 Interaction |
| Action → 日程 | Action 详情：「安排时间」 | 新 Event，关联此 Action |
| Action 完成 → 写结果 | Action 标记 done → 弹窗 | 新 Interaction（channel=结果），关联此 Action |
| 日程 → 会前待办 | 日程创建时「自动创建会前待办」（已有） | 已有，保留 |
| 日程 → 写纪要 | 日程详情：「写纪要」 | 新 Interaction（channel=会议纪要），关联此 Event |

## 状态流（Action 简化后）

```
inbox ──→ open ──→ done
  │          │
  │          └──→ waiting ──→ done
  │                        │
  │                        └──→ open（等到了，继续做）
  │
  └──→ dropped
```

- **inbox**: 刚创建，未分类
- **open**: 我要做（contactId = 帮谁做）
- **waiting**: 等对方（contactId = 在等谁）
- **done**: 已完成 → 提示写结果
- **dropped**: 放弃

下一状态转换（Action 详情页）：
```
inbox → open (默认)
open → waiting | done
waiting → open（等到了）| done
```

## 实施计划（按优先级）

### Phase 1：Schema + Service 简化
- 移除 Action.waitingOnId（schema + service + test + form）
- Interaction.contactId 改为可选
- Interaction 增加 actionId, eventId
- 数据迁移（现有 Action waitingOnId → status=waiting）

### Phase 2：⌘K 统一捕捉
- ⌘K 支持 Action / Event 创建
- 自然语言自动分类（chrono 已有）
- 创建后 auto-redirect 到详情

### Phase 3：/today 统一时间线
- 混排 Action + 今日 Event + 近期 Interaction
- 过期 Action 标红
- 每条可快捷操作

### Phase 4：联系人统一时间线
- 从分 tab 改为统一时间线
- 混排 Interaction + Action + Event

### Phase 5：转化按钮
- 记录详情：创建待办 / 创建日程
- Action 详情：安排时间
- Action done 弹窗写结果 → 自动创建 Interaction
- 日程详情：写纪要 → 创建 Interaction
