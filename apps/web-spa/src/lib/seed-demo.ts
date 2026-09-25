import type { PRMAdapter } from './adapter/types';

// First-run demo data — EXACTLY this scenario, nothing more:
//   联系人 张三
//   联系人 李四
//   待办   体验 Weavine 语音功能
//   日程   明天晚上和张三吃饭（关联张三）
//   笔记   和张三交流记录（关联张三，内容：和张三讨论了同学聚会事宜）
//   项目   同学聚会筹备（成员：张三）
//
// Deliberately minimal: every seeded row is one the user may want to
// delete, so we keep the count as low as the showcase allows.
//
// Runs at most once per user: guarded by a localStorage flag AND an
// empty-workspace check, so an existing user who clears localStorage never
// gets phantom rows injected.

const SEED_FLAG_PREFIX = 'weavine:seeded:';

// StrictMode runs effects twice in dev; without this shared promise both
// runs would pass the empty-workspace check and create duplicate contacts.
let inFlight: Promise<boolean> | null = null;

export const SEED_CONTACT_NICKNAME = '张三';

export function seedDemoDataIfEmpty(
  adapter: PRMAdapter,
  userId: string,
): Promise<boolean> {
  if (!inFlight) {
    inFlight = seedOnce(adapter, userId).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function seedOnce(adapter: PRMAdapter, userId: string): Promise<boolean> {
  const flagKey = `${SEED_FLAG_PREFIX}${userId}`;
  if (localStorage.getItem(flagKey)) return false;

  const contacts = await adapter.contacts.list({
    user_id: userId,
    limit: 1,
  });
  if (contacts.items.length > 0) {
    // Existing user — never inject demo rows, just mark as seen.
    localStorage.setItem(flagKey, '1');
    return false;
  }

  const zhangsan = await adapter.contacts.create({
    user_id: userId,
    nickname: SEED_CONTACT_NICKNAME,
  });
  const lisi = await adapter.contacts.create({
    user_id: userId,
    nickname: '李四',
  });

  // Every step is best-effort: one failed create must not abort the rest
  // (a half-seeded workspace used to stay half-seeded forever because the
  // flag was only set at the very end).
  const step = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      console.warn('[seed] step failed:', e);
    }
  };

  // Todo due this evening — nudge the user to try voice capture.
  const tonight = new Date();
  tonight.setHours(21, 0, 0, 0);
  if (tonight.getTime() < Date.now() + 30 * 60_000) {
    tonight.setDate(tonight.getDate() + 1);
    tonight.setHours(10, 0, 0, 0);
  }
  await step(() =>
    adapter.actions.create({
      user_id: userId,
      title: '体验 Weavine 语音功能',
      status: 'inbox',
      priority: 1,
      due_at: tonight.toISOString(),
    }),
  );

  // Dinner tomorrow evening with 张三.
  const tomorrowDinner = new Date();
  tomorrowDinner.setDate(tomorrowDinner.getDate() + 1);
  tomorrowDinner.setHours(19, 0, 0, 0);
  const dinnerEnd = new Date(tomorrowDinner.getTime() + 2 * 60 * 60_000);
  await step(() =>
    adapter.events.create({
      user_id: userId,
      title: '明天晚上和张三吃饭',
      type: '聚餐',
      start_at: tomorrowDinner.toISOString(),
      end_at: dinnerEnd.toISOString(),
      participant_contact_ids: [zhangsan.id],
    }),
  );

  // Note linked to 张三.
  await step(() =>
    adapter.notes.create(userId, {
      title: '和张三交流记录',
      body: '和张三讨论了同学聚会事宜。',
      entity_links: [{ entity_type: 'contact', entity_id: zhangsan.id }],
    }),
  );

  // Interaction with 李四 (yesterday's phone call).
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(18, 0, 0, 0);
  await step(() =>
    adapter.interactions.create({
      user_id: userId,
      contact_id: lisi.id,
      occurred_at: yesterday.toISOString(),
      channel: '电话',
      summary: '昨天电话沟通',
    }),
  );

  // Project with 张三 as a member.
  await step(async () => {
    const project = await adapter.projects.create({
      user_id: userId,
      title: '同学聚会筹备',
      template: 'default',
    });
    await adapter.projectContacts.add(project.id, zhangsan.id);
  });

  localStorage.setItem(flagKey, '1');
  return true;
}
