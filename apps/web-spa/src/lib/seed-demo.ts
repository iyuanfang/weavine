import type { PRMAdapter } from './adapter/types';

// First-run demo data: a brand-new user opens an empty graph, which is the
// most discouraging moment of the product. Seed one sample contact (plus the
// common tags), one sample todo and one sample event so the home page has
// something to show and the user can immediately try voice capture
// ("体验 Weavine 语音功能") against real rows.
//
// Runs at most once per user: guarded by a localStorage flag AND an
// empty-workspace check, so an existing user who clears localStorage never
// gets phantom rows injected.

const SEED_FLAG_PREFIX = 'weavine:seeded:';

export const SEED_TAG_NAMES = ['同学', '同事', '朋友'] as const;
export const SEED_CONTACT_NICKNAME = '王小明';

export async function seedDemoDataIfEmpty(
  adapter: PRMAdapter,
  userId: string,
): Promise<boolean> {
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

  // Tags: create the common ones, reuse if the names already exist.
  const existingTags = await adapter.tags.list(userId).catch(() => []);
  const tagIds: string[] = [];
  for (const name of SEED_TAG_NAMES) {
    const found = existingTags.find((t) => t.name === name);
    if (found) {
      tagIds.push(found.id);
    } else {
      try {
        const t = await adapter.tags.create({ user_id: userId, name });
        tagIds.push(t.id);
      } catch {
        // Tag creation is cosmetic — never block seeding on it.
      }
    }
  }

  const contact = await adapter.contacts.create({
    user_id: userId,
    nickname: SEED_CONTACT_NICKNAME,
    name: '王小明',
    company: '示例科技',
    title: '产品经理',
    importance: 'medium',
    tag_ids: tagIds.length > 0 ? tagIds : null,
  });

  // Todo due this evening — nudge the user to try voice capture.
  const tonight = new Date();
  tonight.setHours(21, 0, 0, 0);
  if (tonight.getTime() < Date.now() + 30 * 60_000) {
    tonight.setDate(tonight.getDate() + 1);
    tonight.setHours(10, 0, 0, 0);
  }
  await adapter.actions.create({
    user_id: userId,
    title: '体验 Weavine 语音功能',
    status: 'inbox',
    priority: 1,
    due_at: tonight.toISOString(),
  });

  // Sample meeting tomorrow 10:00 with the seed contact.
  const tomorrow10 = new Date();
  tomorrow10.setDate(tomorrow10.getDate() + 1);
  tomorrow10.setHours(10, 0, 0, 0);
  const tomorrow11 = new Date(tomorrow10.getTime() + 60 * 60_000);
  await adapter.events.create({
    user_id: userId,
    title: `和${SEED_CONTACT_NICKNAME}开会`,
    type: 'meeting',
    start_at: tomorrow10.toISOString(),
    end_at: tomorrow11.toISOString(),
    location: '线上会议',
    participant_contact_ids: [contact.id],
  });

  localStorage.setItem(flagKey, '1');
  return true;
}
