/**
 * Resolve a detail page's back navigation target from a `?from=` query param.
 *
 * - `null` / empty → fallback (the natural list for this entity)
 * - exact match → known list, label says where you're going
 * - prefix match → nested route (e.g. `/contacts/{id}`, `/projects/{id}`),
 *   we trust the source path as both href and label hint
 *
 * The result `{ href, label }` is used for the detail page's "← 返回" link,
 * delete redirects, and the edit-link `?from=` propagation.
 */
export function backTarget(
  from: string | null,
  fallback: string,
): { href: string; label: string } {
  if (!from) return { href: fallback, label: '← 返回' };

  if (from === '/actions') return { href: '/actions', label: '← 待办列表' };
  if (from === '/calendar') return { href: '/calendar', label: '← 日历' };
  if (from === '/contacts') return { href: '/contacts', label: '← 联系人列表' };
  if (from === '/projects') return { href: '/projects', label: '← 项目列表' };
  if (from === '/reminders') return { href: '/reminders', label: '← 提醒' };
  if (from === '/archive') return { href: '/archive', label: '← 归档' };
  if (from === '/search') return { href: '/search', label: '← 搜索' };

  if (from.startsWith('/contacts/')) return { href: from, label: '← 联系人' };
  if (from.startsWith('/projects/')) return { href: from, label: '← 项目' };
  if (from.startsWith('/tags/')) return { href: from, label: '← 标签' };
  if (from.startsWith('/interactions/')) return { href: from, label: '← 互动' };
  if (from.startsWith('/actions/')) return { href: from, label: '← 待办' };
  if (from.startsWith('/events/')) return { href: from, label: '← 日程' };

  return { href: from, label: '← 返回' };
}