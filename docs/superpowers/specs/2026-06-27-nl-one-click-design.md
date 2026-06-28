# PRM 自然语言一键录入设计

> 用户在 ⌘K 面板中输入自然语句，系统自动识别意图并创建互动/待办/日程，无需手动填写表单。

## 核心原则

1. **一键为王**：高置信度场景直接创建，不弹多余对话框
2. **智能兜底**：低置信度打开预填弹窗让用户补全，不丢失已解析信息
3. **零学习成本**：不新增 UI 入口，复用 ⌘K 面板（CommandPalette），用户想怎么输入就怎么输入

## 架构

```
用户输入 → CommandPalette (⌘K)
                │
                ├─ 像搜索 → 显示搜索结果（已有逻辑）
                │
                └─ 像创建意图 → nl-parser.ts 解析
                       │
                       ├─ 高置信度 → 直接调 quickLogAction → router.refresh()
                       │
                       └─ 低置信度 → 打开 QuickLog 弹窗（字段预填）
```

### 改动文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/lib/nl-parser.ts` | **新建** | 解析引擎：类型分类 + 时间提取 + 联系人匹配 + 置信度 |
| `src/components/command-palette.tsx` | **改造** | 接入 NL 解析，显示创建选项，高低置信度分流 |
| `src/components/quick-log.tsx` | **改造** | 接受预填 props，作为低置信度兜底弹窗 |
| `src/components/top-nav.tsx` | **改造** | 给 CommandPalette 传入 contacts 列表 |
| `src/lib/nl-classify.ts` | **删除** | 功能并入 nl-parser.ts |
| `src/components/quick-log.tsx` 中的 `import` | **更新** | 从 nl-classify 改为 nl-parser |

## nl-parser.ts 解析引擎

### 类型定义

```typescript
type ParsedIntent = {
  type: 'interaction' | 'action' | 'event';
  title: string;          // 解析后剩余的文本 = 标题/概要
  date: Date | null;
  contactId: string | null;
  contactName: string | null;
  isNewContact: boolean;  // 联系人不存在，需要自动创建
  location: string | null;
  channel: string | null;
  confidence: number;     // 0~1，阈值 0.7 以上为高置信度
};
```

### 解析流程

```
输入文本
  ↓ step1: 提取时间 → extractDates() 从 date-parser，移除匹配文本
  ↓ step2: 分类意图 → classifyInput() 增强版
  ↓ step3: 提取地点 → 匹配"在X""去X""到X"模式，移除匹配文本
  ↓ step4: 提取渠道 → 匹配"微信""电话""邮件"等关键词，移除匹配文本
  ↓ step5: 匹配联系人 → 模糊匹配 contacts[] 的 nickname/name，移除匹配文本
  ↓ step6: 剩余文本 → 作为 title/summary
  ↓ step7: 计算置信度
```

### 增强版分类器（替代 nl-classify.ts）

| 输入特征 | 分类 | 示例 |
|---|---|---|
| 过去时（了/过/刚/已经）+ 联系人 | interaction | "刚跟李四聊了融资" → 互动 |
| 未来行动（发/做/跟进/买/联系/交）| action | "明天发合同给张三" → 待办 |
| 见面词（见/开会/约/吃饭）+ 具体时间 | event | "周六下午2点见王五" → 日程 |
| 时间 + 中性词（沟通/讨论/确认）| action（优先于 interaction） | "明天沟通方案" → 待办 |
| 无特征 | action | "买办公用品" → 待办 |

### 联系人匹配

- 逐 token 匹配 contacts[] 的 nickname 和 name
- 优先级：全匹配 > 前缀匹配 > 包含匹配
- 移除匹配到的文本，剩余做标题
- 匹配不到但看起来像人名（2-4个中文字符的连续 token）→ `isNewContact = true`

### 置信度算法

| 类型 | 高置信度条件 | 低置信度 |
|---|---|---|
| interaction | summary 有值 + contactId 有值 | 缺任一 |
| action | title 有值 (always) | never（有文本就能创待办）|
| event | title 有值 + startAt 有值 | 缺时间 |

- 阈值 `≥ 0.7` = 高置信度，直接创建
- `< 0.7` = 低置信度，打开 QuickLog 弹窗

## CommandPalette 改造

### 新增逻辑（不破坏现有搜索功能）

1. 在 `useEffect` 中，输入变化 300ms 防抖后运行 `parseNL(text, contacts)`
2. 如果有解析结果，在搜索结果上方显示一条 `Command.Item`：
   - 高置信度：`📝 创建{类型}: {标题}` + 子标题显示解析详情
   - 低置信度：`✏️ 创建{类型}: {标题}（补全信息）`
3. 选中该 Item 时：
   - 高置信度 → 组装 FormData → `quickLogAction(fd)` → `router.refresh()`
   - 低置信度 → 设置 QuickLog 弹窗的预填 state → 打开弹窗
4. 正常搜索结果仍然显示在下方，互不干扰

### 联系人列表获取

新增 `GET /api/contacts/light` 返回 `{id, nickname, name}[]`，CommandPalette 打开时 fetch 一次并缓存。

## QuickLog 改造

### 新增 Props

```typescript
type QuickLogProps = {
  contacts: PickerContact[];
  // 新增：预填状态
  initial?: {
    type: QuickLogType;
    summary?: string;
    title?: string;
    dueAt?: Date | null;
    startAt?: Date | null;
    contactId?: string;
    newContactName?: string;
    location?: string;
    channel?: string;
  };
};
```

- 当 `initial` 传入时，弹窗各字段按预填值初始化
- 用户可直接修改再提交，不丢失已解析的信息

### TopNav 改造

将 contacts 从父级 Server Component 传入：

```tsx
// layout.tsx 或对应 Server Component
const contacts = await ContactService.listLight(ownerId);
return <TopNav currentUser={...} contacts={contacts} />;
```

## 用户交互示例

### 场景 1：高置信度 — 一键待办

```
按 ⌘K → 输入 "发合同给张三"
  ↓ parseNL → type=action, title=发合同, contactName=张三, confidence=0.9
  ↓ 面板显示 "📝 创建待办: 发合同 → 张三"
  ↓ 回车 → 直接创建 → 面板关闭 → 刷新
```

### 场景 2：高置信度 — 一键互动

```
按 ⌘K → 输入 "刚跟李四聊了融资进展"
  ↓ parseNL → type=interaction, summary=聊了融资进展, contactName=李四, confidence=0.9
  ↓ 面板显示 "📝 创建互动: 聊了融资进展 · 李四"
  ↓ 回车 → 直接创建 → 刷新
```

### 场景 3：高置信度 — 自动创建新联系人

```
按 ⌘K → 输入 "明天下午3点 发合同给赵六"
  ↓ parseNL → 赵六 不在联系人列表 → isNewContact=true
  ↓ 面板显示 "📝 创建待办: 发合同 → +赵六（新联系人）"
  ↓ 回车 → 创建联系人赵六 + 创建待办 → 刷新
```

### 场景 4：低置信度 — 弹窗补全

```
按 ⌘K → 输入 "周六下午2点"
  ↓ parseNL → type=event, date=周六14:00, 无标题无联系人, confidence=0.3
  ↓ 面板显示 "✏️ 创建日程（补全信息）"
  ↓ 回车 → 弹出 QuickLog，开始时间已填好，用户输入标题和联系人
```

### 场景 5：纯搜索（不触发 NL）

```
按 ⌘K → 输入 "张三"
  ↓ parseNL → 看起来不像创建意图 → 不显示创建选项
  ↓ 正常显示联系人搜索结果
```

## 边界情况

- **空输入/过短（<4字符）** → 不触发 NL 解析
- **已有关联系人匹配** → 优先匹配 nickname，其次 name
- **多个人名匹配** → 取第一个匹配到的
- **多个时间匹配** → 取 extractDates 的第一个
- **解析失败** → 不显示创建选项，纯搜索模式