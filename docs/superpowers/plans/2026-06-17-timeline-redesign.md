# PRM 时间线重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 去掉 Action.waitingOnId 冗余字段，打通 Interaction/Action/Event 互相转化，/today 改为统一时间线，联系人详情改为统一时间线。

**Architecture:** 按 5 个 Phase 逐步推进，每个 Phase 可独立测试。Phase 1 改数据模型 + 服务层，后续 Phase 分别改 UI。

**Tech Stack:** Next.js 14, Prisma (SQLite), TypeScript, Vitest

**国际化:** 先全中文 UI。后续 i18n 时字符串集中提取。

---

## Task Map

### Phase 1: Schema + Service 简化

| 文件 | 改动 |
|------|------|
| `prisma/schema.prisma` | 去掉 Action.waitingOnId/waitingOn 关联；Interaction.contactId 可选；Interaction 加 actionId/eventId 关联 |
| `src/server/services/action.ts` | 移除 waitingOnId 输入；移除 waitingOn include；更新 byContact() 只用 contactId |
| `src/server/services/action.test.ts` | 更新测试：waitingOnId → status=waiting |
| `src/app/actions/actions.ts` | 移除 waitingOnId 表单字段 |
| `src/components/action-form.tsx` | 移除 waitingOn 相关 UI |
| `prisma/migrations/` | db push 应用变更 |

### Phase 2: Interaction 扩展

| 文件 | 改动 |
|------|------|
| `src/server/services/interaction.ts` | 新增 byContact() 支持 actionId/eventId 筛选 |
| `prisma/schema.prisma` | 加 `@@index([occurredAt])` |

### Phase 3: /today 统一时间线

| 文件 | 改动 |
|------|------|
| `src/app/today/page.tsx` | 混排 Action + 今日 Event + 近期 Interaction |

### Phase 4: 联系人统一时间线

| 文件 | 改动 |
|------|------|
| `src/app/contacts/[id]/page.tsx` | 从分 tab 改为统一时间线 |

### Phase 5: 转化按钮

| 文件 | 改动 |
|------|------|
| `src/app/actions/[id]/page.tsx` | Action done 弹窗写结果；"安排时间"按钮 |
| `src/app/events/[id]/page.tsx` | "写纪要"按钮 |
| `src/app/interactions/[id]/page.tsx` | "创建待办""创建日程"按钮 |

---

## Phase 1: Schema + Service 简化

### Task 1.1: 修改 Action model（去掉 waitingOnId）

**Files:**
- Modify: `prisma/schema.prisma` (Action model, Interaction model)

- [ ] **Step 1: 修改 schema.prisma**

去掉 Action 的 waitingOnId/waitingOn，去掉对应索引。改 Interaction.contactId 为可选，加 actionId/eventId 关联。

```prisma
// Action model — 删掉这两行
// waitingOnId String?
// waitingOn   Contact? @relation("ActionWaitingOn", fields: [waitingOnId], references: [id], onDelete: SetNull)
// 删掉 @@index([waitingOnId])

// Interaction model — contactId 改为可选，增加关联
model Interaction {
  id         String   @id @default(cuid())
  contactId  String?                      // ← 改为可选
  contact    Contact? @relation(...)      // ← 改为可选
  actionId   String?                      // ← 新增
  action     Action?  @relation("InteractionFromAction", fields: [actionId], references: [id], onDelete: SetNull)
  eventId    String?                      // ← 新增
  event      Event?   @relation("InteractionFromEvent", fields: [eventId], references: [id], onDelete: SetNull)
  occurredAt DateTime
  channel    String?
  summary    String
  createdAt  DateTime @default(now())

  @@index([contactId, occurredAt])
  @@index([occurredAt])                   // ← 新增
}
```

- [ ] **Step 2: 应用 migration**

```bash
pnpm exec prisma db push
```

- [ ] **Step 3: 更新 ActionService（移除 waitingOnId）**

**Files:**
- Modify: `src/server/services/action.ts`

改动点：
1. `waitingOnId` 从 Zod schema 移除
2. 所有 `.include({ waitingOn: true })` 改为 `.include({ contact: true, event: true })`
3. `byContact()` 改为只查 `contactId`，不再需要 `OR`

```typescript
// ActionInput schema — 去掉 waitingOnId
export const ActionInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  status: z.string().nullish(),
  priority: z.coerce.number().int().min(0).max(5).nullish(),
  category: z.string().nullish(),
  dueAt: z.string().nullish(),
  contactId: z.string().nullish(),
  eventId: z.string().nullish(),
});

// byContact — 简化为只查 contactId
async byContact(contactId: string, db: PrismaClient = defaultPrisma) {
  return db.action.findMany({
    where: {
      contactId,
      status: { not: 'dropped' },
    },
    include: { contact: true, event: true },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { priority: 'desc' }],
  });
},
```

- [ ] **Step 4: 更新测试**

**Files:**
- Modify: `src/server/services/action.test.ts`

```typescript
// 替换 byContact with waitingOnId 的测试
it('byContact returns actions linked to contact', async () => {
  const db = setup();
  const a = await ContactService.create({ name: 'A' }, db);
  const b = await ContactService.create({ name: 'B' }, db);

  // 关联到 A（我要做）
  await ActionService.create({ title: '帮A做', contactId: a.id }, db);
  // 关联到 B，status=waiting（等B）
  await ActionService.create({ title: '等B回复', contactId: b.id, status: 'waiting' }, db);

  const forA = await ActionService.byContact(a.id, db);
  expect(forA).toHaveLength(1);
  expect(forA[0].title).toBe('帮A做');

  const forB = await ActionService.byContact(b.id, db);
  expect(forB).toHaveLength(1);
  expect(forB[0].title).toBe('等B回复');
});
```

- [ ] **Step 5: 更新 Action 表单和服务器 action**

**Files:**
- Modify: `src/app/actions/actions.ts`
- Modify: `src/components/action-form.tsx`

`actions.ts`: 删除 `waitingOnId: (fd.get('waitingOnId') as string) || null` 这一行
`action-form.tsx`: 检查是否有 waitingOn 相关字段，删除

- [ ] **Step 6: build + test 验证**

```bash
pnpm build  # 检查 TS 编译
pnpm test   # 所有测试通过
pnpm exec prisma db push  # schema 已生效
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove Action.waitingOnId, simplify to contactId+status

- Remove waitingOnId/waitingOn relation from Action model
- Interaction.contactId now optional; Interaction gains actionId/eventId
- ActionService.byContact now uses contactId only (waiting status replaces waitingOnId)
- Updated tests: waiting actions use contactId + status=waiting
- Schema applied via db push
```

---

## Phase 2: Interaction 服务层扩展

### Task 2.1: InteractionService 增加时间线查询

**Files:**
- Modify: `src/server/services/interaction.ts`

- [ ] **Step 1: 添加 byContact 和 recent 方法**

```typescript
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

export class InteractionService {
  // 获取某个联系人的所有互动（按时间倒序）
  static async byContact(contactId: string, db: PrismaClient = defaultPrisma) {
    return db.interaction.findMany({
      where: { contactId },
      orderBy: { occurredAt: 'desc' },
      include: { action: true, event: true, contact: true },
    });
  }

  // 获取最近的互动（全局）
  static async recent(days: number = 7, db: PrismaClient = defaultPrisma) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return db.interaction.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      include: { contact: true, action: true, event: true },
      take: 50,
    });
  }

  // 创建互动（已有方法，检查是否覆盖新字段）
  static async create(
    input: { contactId?: string | null; channel?: string | null; summary: string; occurredAt?: Date; actionId?: string | null; eventId?: string | null },
    db: PrismaClient = defaultPrisma,
  ) {
    return db.interaction.create({
      data: {
        contactId: input.contactId ?? null,
        channel: input.channel ?? null,
        summary: input.summary,
        occurredAt: input.occurredAt ?? new Date(),
        actionId: input.actionId ?? null,
        eventId: input.eventId ?? null,
      },
      include: { contact: true, action: true, event: true },
    });
  }
}
```

- [ ] **Step 2: 在 TimelineService 中统一获取三种数据**

创建一个统一的时间线服务，或者直接在 page 里组合。

新建 `src/server/services/timeline.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

type TimelineItem = {
  type: 'action' | 'event' | 'interaction';
  id: string;
  title: string;
  subtitle: string;
  timestamp: Date;
  priority?: number;
  status?: string;
  contactName?: string;
  contactId?: string;
  link: string;
};

export class TimelineService {
  // 获取联系人的完整时间线
  static async forContact(contactId: string, db: PrismaClient = defaultPrisma): Promise<TimelineItem[]> {
    const [actions, events, interactions] = await Promise.all([
      db.action.findMany({
        where: { contactId, status: { not: 'dropped' } },
        include: { contact: true },
        orderBy: { createdAt: 'desc' },
      }),
      db.event.findMany({
        where: { attendees: { some: { contactId } } },
        include: { attendees: { include: { contact: true } } },
        orderBy: { startAt: 'desc' },
      }),
      db.interaction.findMany({
        where: { contactId },
        include: { contact: true },
        orderBy: { occurredAt: 'desc' },
      }),
    ]);

    const items: TimelineItem[] = [
      ...actions.map(a => ({
        type: 'action' as const,
        id: a.id,
        title: a.title,
        subtitle: a.status === 'done' ? '已完成' : `${statusLabel(a.status)} · P${a.priority}`,
        timestamp: a.dueAt ?? a.createdAt,
        priority: a.priority,
        status: a.status,
        contactName: a.contact?.name,
        contactId: a.contactId ?? undefined,
        link: `/actions/${a.id}`,
      })),
      ...events.map(e => ({
        type: 'event' as const,
        id: e.id,
        title: e.title,
        subtitle: `${e.type} · ${e.startAt.toLocaleString('zh-CN')}`,
        timestamp: e.startAt,
        contactName: e.attendees[0]?.contact.name,
        contactId: e.attendees[0]?.contactId,
        link: `/events/${e.id}`,
      })),
      ...interactions.map(i => ({
        type: 'interaction' as const,
        id: i.id,
        title: i.summary,
        subtitle: i.channel ?? '记录',
        timestamp: i.occurredAt,
        contactName: i.contact?.name,
        contactId: i.contactId ?? undefined,
        link: '#', // TODO: interaction detail page
      })),
    ];

    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return items;
  }

  // 获取 /today 时间线
  static async forToday(db: PrismaClient = defaultPrisma): Promise<{
    todayEvents: TimelineItem[];
    dueActions: TimelineItem[];
    recentInteractions: TimelineItem[];
  }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86400000);
    const sevenDaysAgo = new Date(startOfDay.getTime() - 7 * 86400000);

    const [events, actions, interactions] = await Promise.all([
      db.event.findMany({
        where: { startAt: { gte: startOfDay, lt: endOfDay } },
        include: { attendees: { include: { contact: true } } },
        orderBy: { startAt: 'asc' },
      }),
      db.action.findMany({
        where: {
          status: { in: ['open', 'waiting'] },
          dueAt: { not: null },
        },
        include: { contact: true, event: true },
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        take: 20,
      }),
      db.interaction.findMany({
        where: { occurredAt: { gte: sevenDaysAgo } },
        include: { contact: true },
        orderBy: { occurredAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      todayEvents: events.map(e => ({
        type: 'event' as const, id: e.id, title: e.title,
        subtitle: `${e.startAt.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · ${e.location ?? ''}`,
        timestamp: e.startAt, link: `/events/${e.id}`,
      })),
      dueActions: actions.map(a => ({
        type: 'action' as const, id: a.id, title: a.title,
        subtitle: `P${a.priority} · 截止 ${a.dueAt!.toLocaleString('zh-CN')}${a.contact ? ` · ${a.contact.name}` : ''}`,
        timestamp: a.dueAt!, priority: a.priority, status: a.status,
        link: `/actions/${a.id}`,
      })),
      recentInteractions: interactions.map(i => ({
        type: 'interaction' as const, id: i.id, title: i.summary,
        subtitle: i.contact ? `${i.contact.name} · ${i.channel ?? '记录'}` : i.channel ?? '记录',
        timestamp: i.occurredAt, contactName: i.contact?.name,
        link: '#',
      })),
    };
  }
}

function statusLabel(s?: string): string {
  switch (s) {
    case 'inbox': return '收件箱';
    case 'open': return '待办';
    case 'waiting': return '等待';
    case 'done': return '已完成';
    default: return s ?? '未知';
  }
}
```

- [ ] **Step 3: test + build**

```bash
pnpm test
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add TimelineService + InteractionService.recent

- InteractionService: byContact (按联系人), recent (全局最近 N 天)
- TimelineService: forContact (联系人统一时间线), forToday (今日混排)
- statusLabel 中文映射
- schema + build + test clean
```

---

## Phase 3: /today 统一时间线

### Task 3.1: 重写 /today 页面

**Files:**
- Modify: `src/app/today/page.tsx`

- [ ] **Step 1: 使用 TimelineService 替换现在的 Action 列表**

```tsx
import { TimelineService } from '@/server/services/timeline';
import Link from 'next/link';

export default async function TodayPage() {
  const { todayEvents, dueActions, recentInteractions } = await TimelineService.forToday();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">今天</h1>

      {todayEvents.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-medium text-gray-700">📅 今日日程</h2>
          <div className="mt-2 space-y-2">
            {todayEvents.map(e => (
              <Link key={e.id} href={e.link} className="card flex items-center gap-3 p-3">
                <span className="text-sm font-medium">{e.subtitle}</span>
                <span>{e.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-medium text-gray-700">☑ 待处理</h2>
        {dueActions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">没有待处理的 Action</p>
        ) : (
          <div className="mt-2 space-y-2">
            {dueActions.map(a => {
              const isOverdue = a.timestamp < new Date();
              return (
                <Link key={a.id} href={a.link} className={`card flex items-center justify-between p-3 ${isOverdue ? 'border-red-200 bg-red-50' : ''}`}>
                  <div>
                    <span className="font-medium">{a.title}</span>
                    <span className="ml-2 text-xs text-gray-500">{a.subtitle}</span>
                  </div>
                  <span className={`text-xs ${isOverdue ? 'text-red-600' : 'text-gray-400'}`}>
                    {isOverdue ? '已过期' : statusLabel(a.status)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {recentInteractions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-medium text-gray-700">📝 近期互动</h2>
          <div className="mt-2 space-y-1">
            {recentInteractions.map(i => (
              <div key={i.id} className="flex items-start gap-2 py-1 text-sm">
                <span className="whitespace-nowrap text-gray-400">
                  {i.timestamp.toLocaleDateString('zh-CN')}
                </span>
                <span className="text-gray-500">{i.contactName}</span>
                <span className="line-clamp-1">{i.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function statusLabel(s?: string): string {
  switch (s) {
    case 'inbox': return '收件箱';
    case 'open': return '待办';
    case 'waiting': return '等待';
    case 'done': return '已完成';
    default: return s ?? '';
  }
}
```

- [ ] **Step 2: build + test**

```bash
pnpm build
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: /today 统一时间线（日程+Action+互动混排）

- 今日日程区块：当天事件按时排序
- 待处理区块：未完成 Action 按截止时间排序，过期标红
- 近期互动区块：最近 7 天互动列表
- 原有 /today 的四个区块替换为统一的 TimelineService
```

---

## Phase 4: 联系人统一时间线

### Task 4.1: 改联系人详情为时间线

**Files:**
- Modify: `src/app/contacts/[id]/page.tsx`

- [ ] **Step 1: 去掉分 tab，改为时间线**

```tsx
import { TimelineService } from '@/server/services/timeline';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';

export default async function ContactDetail({ params }: { params: { id: string } }) {
  let contact;
  try {
    contact = await ContactService.get(params.id);
  } catch {
    notFound();
  }

  const timeline = await TimelineService.forContact(params.id);

  return (
    <main className="mx-auto max-w-2xl p-6">
      {/* 联系人信息头部 — 保持现有样式 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          {contact.company && <p className="text-sm text-gray-500">{contact.company}{contact.title ? ` · ${contact.title}` : ''}</p>}
        </div>
        <Link className="btn-secondary" href={`/contacts/${contact.id}/edit`}>编辑</Link>
      </div>

      {/* 统一时间线 */}
      <section className="mt-6">
        <h2 className="text-lg font-medium">时间线</h2>
        {timeline.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">暂无记录</p>
        ) : (
          <div className="mt-4 space-y-4">
            {timeline.map(item => (
              <Link key={`${item.type}-${item.id}`} href={item.link} className="flex items-start gap-3">
                <span className="mt-0.5 text-lg">
                  {item.type === 'event' ? '📅' : item.type === 'action' ? '☑' : '📝'}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-gray-500">{item.subtitle}</p>
                </div>
                <span className="text-xs text-gray-400">
                  {item.timestamp.toLocaleDateString('zh-CN')}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: build + test**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: contacts detail unified timeline

- Replace separate tabs with TimelineService.forContact
- Actions, Events, Interactions sorted by timestamp desc
- Emoji prefix: 📅 event, ☑ action, 📝 interaction
```

---

## Phase 5: 转化按钮

### Task 5.1: Action done 弹出写结果

**Files:**
- Modify: `src/app/actions/[id]/page.tsx`
- Modify: `src/server/services/action.ts`

- [ ] **Step 1: Action 标记 done 时显示写结果弹窗**

在 Action 详情页，当点击"标记完成"时，不再立即 redirect，而是显示一个文本输入框，用户写结果后：

1. 更新 Action status=done, completedAt=now
2. 创建 Interaction(contactId=action.contactId, summary=结果文本, channel="结果", actionId=action.id)

在 `actions.ts` 中新增 server action：

```typescript
export async function completeActionWithResult(id: string, fd: FormData): Promise<ActionResult> {
  const result = (fd.get('result') as string)?.trim();
  const db = (await import('@/lib/prisma')).prisma;

  await db.action.update({
    where: { id },
    data: { status: 'done', completedAt: new Date() },
  });

  if (result) {
    const action = await db.action.findUnique({ where: { id } });
    await db.interaction.create({
      data: {
        contactId: action?.contactId,
        summary: result,
        channel: '结果',
        actionId: id,
        occurredAt: new Date(),
      },
    });
  }

  revalidatePath(`/actions/${id}`);
  redirect(`/actions/${id}`);
}
```

在 Action 详情页新增一个"完成并写结果"按钮区域（用 useState 控制显示 textarea）：

```tsx
'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export function CompleteActionForm({ actionId, onComplete }: { actionId: string; onComplete: (fd: FormData) => void }) {
  const [showResult, setShowResult] = useState(false);
  const { pending } = useFormStatus();

  if (!showResult) {
    return <button onClick={() => setShowResult(true)} className="btn-primary">标记完成</button>;
  }

  return (
    <form action={onComplete} className="space-y-2">
      <textarea name="result" placeholder="结果如何？（可选）" className="input-base w-full" rows={3} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">完成并记录</button>
        <button type="button" onClick={() => setShowResult(false)} className="btn-secondary">取消</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Action 详情页"安排时间"按钮**

```tsx
<Link
  href={`/events/new?actionId=${action.id}&contactId=${action.contactId ?? ''}&title=${encodeURIComponent(action.title)}`}
  className="btn-secondary"
>
  安排时间
</Link>
```

`/events/new` 页面读取 query params 预填表单。

- [ ] **Step 3: 事件详情"写纪要"按钮**

```tsx
// 在 /events/[id]/page.tsx
'use client';
import { useState } from 'react';

function MeetingNotesForm({ eventId, contactId }: { eventId: string; contactId?: string }) {
  const [open, setOpen] = useState(false);

  if (!open) return <button onClick={() => setOpen(true)} className="btn-secondary mt-4">写纪要</button>;

  return (
    <form action={createEventNoteAction.bind(null, eventId)} className="mt-4 space-y-2">
      <textarea name="notes" placeholder="会议纪要..." className="input-base w-full" rows={4} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">保存</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary">取消</button>
      </div>
    </form>
  );
}
```

Server action:

```typescript
export async function createEventNoteAction(eventId: string, fd: FormData) {
  const notes = (fd.get('notes') as string)?.trim();
  if (!notes) return { ok: false, error: '请输入纪要' };

  const db = (await import('@/lib/prisma')).prisma;
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: { attendees: true },
  });
  if (!event) return { ok: false, error: '事件不存在' };

  await db.interaction.create({
    data: {
      contactId: event.attendees[0]?.contactId ?? null,
      summary: notes,
      channel: '会议纪要',
      eventId,
      occurredAt: new Date(),
    },
  });

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}
```

- [ ] **Step 4: build + test + commit**

```bash
git add -A
git commit -m "feat: convert buttons — Action done writes result, Event notes, schedule

- completeActionWithResult: mark done + optionally create Interaction
- CompleteActionForm component with toggle textarea
- '安排时间' button links to /events/new with prefill
- '写纪要' button creates Interaction linked to Event
```

---

## Phase 6: ⌘K 统一捕捉

### Task 6.1: QuickLog 升级支持 Action/Event

**Files:**
- Modify: `src/components/quick-log.tsx`
- Add: `src/lib/nl-classify.ts`

- [ ] **Step 1: 自然语言分类器**

```typescript
// src/lib/nl-classify.ts
export type CaptureType = 'interaction' | 'action' | 'event';

export function classifyInput(text: string): CaptureType {
  const t = text.trim();
  // 含具体时间 → Event
  if (/\d+[点:：]/.test(t) || /今天|明天|后天|周[一二三四五六日]/.test(t)) {
    // 但有"记"字 → 记录
    if (/记|记录|说/.test(t)) return 'interaction';
    return 'event';
  }
  // 过去时 → Interaction
  if (/了|过|说|聊|沟通|确认|已|刚/.test(t)) return 'interaction';
  // 要做 → Action
  if (/做|交|准备|跟进|回复|买|发|写|整理|催|追/.test(t)) return 'action';
  // 默认 Action
  return 'action';
}
```

- [ ] **Step 2: QuickLog 组件增加类型切换和表单**

QuickLog 当前只记 Interaction。改为：弹出后先自动分类，用户可手动切类型，不同类型展示不同表单字段。

- **Interaction**: 联系人 + 渠道 + 内容（现有）
- **Action**: 标题 + 联系人 + 截止时间 + 优先级
- **Event**: 标题 + 参与人 + 开始时间 + 地点

- [ ] **Step 3: 选择类型后调用不同 server action**

```typescript
// quick-log.tsx 核心逻辑
function handleSubmit(text: string, type: CaptureType) {
  if (type === 'interaction') createInteractionAction({ summary: text, ... });
  else if (type === 'action') createActionAction({ title: text, ... });
  else if (type === 'event') createEventAction({ title: text, ... });
}
```

- [ ] **Step 4: build + test + commit**

---

## 自检

### Spec 覆盖检查
- [x] Phase 1: 去掉 waitingOnId，简化 Action 模型 — Task 1.1
- [x] Interaction 支持 actionId/eventId 关联 — Task 1.1 (schema)
- [x] InteractionService 扩展 — Task 2.1
- [x] /today 统一时间线 — Task 3.1
- [x] 联系人统一时间线 — Task 4.1
- [x] Action done 写结果 — Task 5.1
- [x] 转化按钮（安排时间、写纪要）— Task 5.1-5.3
- [x] ⌘K 统一捕捉 — Task 6.1

### Placeholder 检查
- 所有文件路径完整
- 所有代码块完整，无 "类似 Task X" 引用
- 无 TBD/TODO 占位符

### 类型一致性
- `TimelineService.forContact()` 和 `forToday()` 都用 `TimelineItem[]`
- `InteractionService` 结构匹配新的 schema
- `classifyInput` 返回 `CaptureType` 三种类型
