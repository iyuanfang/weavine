# NL 一键录入实现计划

> 用户在 ⌘K 面板中输入自然语句，系统自动识别意图并创建互动/待办/日程。

## 改动文件清单

| # | 文件 | 操作 | 说明 |
|---|---|---|---|
| 1 | `src/lib/nl-parser.ts` | **新建** | 核心解析引擎 |
| 2 | `src/components/command-palette.tsx` | **改造** | 接入 NL 解析 + 创建逻辑 |
| 3 | `src/components/quick-log.tsx` | **改造** | 接受预填 props |
| 4 | `src/components/top-nav.tsx` | **改造** | 传入 contacts 给 CommandPalette |
| 5 | `src/app/api/contacts/light/route.ts` | **新建** | 轻量联系人列表 API |
| 6 | `src/lib/nl-classify.ts` | **删除** | 内容并入 nl-parser.ts |

## 实现步骤

### Step 1: 新建 `src/lib/nl-parser.ts`

**类型定义：**

```typescript
export type QuickLogType = 'interaction' | 'action' | 'event';

export type ContactCandidate = {
  id: string;
  nickname: string;
  name: string | null;
};

export type ParsedIntent = {
  type: QuickLogType;
  title: string;            // 剩余文本作为标题/概要
  date: Date | null;
  contactId: string | null;
  contactName: string | null;
  isNewContact: boolean;
  location: string | null;
  channel: string | null;
  confidence: number;       // 0~1
};
```

**解析流程（6 步）：**

1. **提取时间** — 用 `extractDates()` 从 `date-parser.ts`，移除匹配文本
2. **分类意图** — `classifyInput()` 增强版
   - 过去时（了/过/刚/已经）+ 联系人 → interaction
   - 未来行动（发/做/跟进/买/联系/交）→ action
   - 见面词（见/开会/约/吃饭）+ 具体时间 → event
   - 时间 + 中性词 → action（优先于 interaction）
   - 默认 → action
3. **提取地点** — 匹配「在X」「去X」「到X」模式，移除匹配文本
4. **提取渠道** — 匹配微信/电话/邮件/线下等关键词，移除匹配文本
5. **匹配联系人** — 模糊匹配 contacts[] 的 nickname/name
   - 全匹配 > 前缀匹配 > 包含匹配
   - 2-4 字中文字符且不在列表中 → `isNewContact = true`
6. **剩余文本 → title/summary**
7. **置信度计算：**
   - `interaction`: title 有值 + contactId 有值 → 0.9，否则 0.4
   - `action`: title 有值 → 0.9（有文本就能创）
   - `event`: title 有值 + date 有值 → 0.9，只有 date → 0.3

**导出 `parseNL(text: string, contacts: ContactCandidate[]): ParsedIntent | null`**
- 空/过短（<4 字符）→ return null
- 没有有意义的内容 → return null

### Step 2: 新建 `/api/contacts/light`

`src/app/api/contacts/light/route.ts` — Server 端 API Route

```typescript
// GET /api/contacts/light
// 返回 { contacts: PickerContact[] }
// 使用 getCurrentUser() + ContactService.listLight()
```

### Step 3: 改造 `command-palette.tsx`

**新增 state：**
- `parsedIntent: ParsedIntent | null` — NL 解析结果
- `pendingQuickLog: ParsedIntent | null` — 当低置信度时，暂存用于传给 QuickLog

**新增逻辑（300ms 防抖）：**

```
useEffect on q change (300ms debounce):
  1. 如果 q < 4 字符 → set parsedIntent(null)
  2. 否则 fetch /api/contacts/light (一次，闭包缓存)
  3. parseNL(q, contacts) → 设置 parsedIntent
```

**新增 UI（在搜索结果上方）：**

```tsx
{parsedIntent && (
  <Command.Group heading="快捷创建">
    <Command.Item onSelect={handleCreate} ...>
      {parsedIntent.confidence >= 0.7
        ? `📝 创建{typeLabel}: {title}`
        : `✏️ 创建{typeLabel}: {title}（补全信息）`}
      <span className="text-xs text-gray-500">
        {show parsedIntent details (date, contact, etc.)}
      </span>
    </Command.Item>
  </Command.Group>
)}
```

**handleCreate：**
- 高置信度 → 调 `quickLogAction()` → `router.refresh()`
- 低置信度 → 设置 `pendingQuickLog` state → 用 QuickLog 组件

**mount QuickLog 组件：**

```tsx
{quickLogPending && (
  <QuickLog
    contacts={contacts}
    open
    initial={{
      type: parsedIntent.type,
      title: parsedIntent.title,
      date: parsedIntent.date,
      contactId: parsedIntent.contactId,
      contactName: parsedIntent.contactName,
      isNewContact: parsedIntent.isNewContact,
      location: parsedIntent.location,
      channel: parsedIntent.channel,
    }}
    onClose={() => setQuickLogPending(null)}
  />
)}
```

**注意：** CommandPalette 目前是 `'use client'`，直接在内部渲染 QuickLog 弹窗，不通过 TopNav。

### Step 4: 改造 `quick-log.tsx`

**新增 Props：**

```typescript
type QuickLogProps = {
  contacts: PickerContact[];
  open?: boolean;           // 可选，外部控制打开
  initial?: {               // 预填值
    type: QuickLogType;
    title?: string;
    date?: Date | null;
    contactId?: string;
    contactName?: string;
    isNewContact?: boolean;
    location?: string;
    channel?: string;
  };
  onClose?: () => void;     // 外部控制关闭回调
};
```

**修改逻辑：**
- 去掉独立的 ⌘K 监听（QuickLog 不再自己注册 ⌘K）
- 当 `initial` 传入时，useEffect 中初始化所有字段
- `onClose` 回调通知父组件关闭
- remove `'use client'` 顶部的 ⌘K 快捷键（已由 CommandPalette 统一管理）

### Step 5: 改造 `top-nav.tsx`

**移除 QuickLog 按钮**（内容被 CommandPalette 取代）
**传入 contacts props 给 CommandPalette：**

从 layout.tsx 传入 contacts:

```tsx
// layout.tsx
const contacts = await ContactService.listLight(ownerId);
// 转成 PickerContact[]
// 传给 TopNav -> CommandPalette
```

但由于 layout.tsx 已经有 session，可以通过 layout.tsx 传 contacts 给 TopNav，或者让 CommandPalette 自己从 API 获取。

**建议方案：** CommandPalette 直接从 `/api/contacts/light` 获取，避免 layout.tsx 改动。这样 TopNav 只需添加一个 prop。

```tsx
// top-nav.tsx — 只传 contacts
<CommandPalette contacts={contacts} />
```

并从 layout.tsx 传入：

```tsx
// layout.tsx
import { ContactService } from '@/server/services/contact';
const session = await auth();
const contacts = session?.user?.id
  ? await ContactService.listLight(session.user.id)
  : [];
const pickerContacts = contacts.map(c => ({
  id: c.id,
  nickname: c.nickname,
  name: c.name,
  company: c.company,
  city: c.city,
}));
<TopNav currentUser={...} contacts={pickerContacts} />
```

### Step 6: 删除 `nl-classify.ts`

- `classifyInput` 和 `QuickLogType` 移植到 `nl-parser.ts`
- 所有 import 更新

## 验证清单

- [ ] ⌘K 面板打开/关闭正常
- [ ] 输入「明天发合同给张三」→ 显示创建选项，回车直接创建 action
- [ ] 输入「刚跟李四聊了融资」→ 显示创建选项，回车直接创建 interaction
- [ ] 输入「周六下午2点」→ 低置信度，回车弹出 QuickLog 预填
- [ ] 输入「张三」→ 纯搜索，不显示创建选项（纯人名）
- [ ] 新联系人自动创建（输入「赵六」不在列表中）
- [ ] 创建后页面刷新
- [ ] 原有搜索功能不受影响
- [ ] LSP diagnostics clean
- [ ] `pnpm build` passes
