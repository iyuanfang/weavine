'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';

type SearchResponse = {
  hits: Array<
    | { type: 'contact'; id: string; nickname: string; name: string | null; company: string | null; city: string | null }
    | { type: 'action'; id: string; title: string; status: string; dueAt: string | null; contact: { id: string; nickname: string; name: string | null } | null }
    | { type: 'event'; id: string; title: string; type_: string; startAt: string; location: string | null;   contact: { id: string; nickname: string; name: string | null } | null }
  >;
};

const SHORTCUTS: { id: string; label: string; hint: string; href?: string; submitKey?: string }[] = [
  { id: 'new-contact', label: '新联系人', hint: '到联系人新建页', href: '/contacts/new' },
  { id: 'new-action', label: '新待办', hint: '到详细新建页', href: '/actions/new' },
  { id: 'new-event', label: '新日程', hint: '到日程新建页', href: '/events/new' },
  { id: 'go-today', label: '今天', hint: '查看今日待办', href: '/today' },
  { id: 'go-actions', label: '待办看板', hint: '拖动管理状态', href: '/actions' },
  { id: 'go-contacts', label: '联系人', hint: '浏览所有联系人', href: '/contacts' },
  { id: 'go-tags', label: '标签', hint: '管理分类标签', href: '/tags' },
  { id: 'go-search', label: '高级搜索', hint: '详细筛选 + NL 解析', href: '/search' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      } else if (open && e.key === '/' && document.activeElement === document.body) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQ('');
      setData(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) {
      setData(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(query));
        if (res.ok) {
          const json = (await res.json()) as SearchResponse;
          setData(json);
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  function runShortcut(id: string) {
    const s = SHORTCUTS.find((x) => x.id === id);
    if (!s?.href) return;
    setOpen(false);
    router.push(s.href);
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const contacts = (data?.hits ?? []).filter((h) => h.type === 'contact') as Extract<
    SearchResponse['hits'][number],
    { type: 'contact' }
  >[];
  const actions = (data?.hits ?? []).filter((h) => h.type === 'action') as Extract<
    SearchResponse['hits'][number],
    { type: 'action' }
  >[];
  const events = (data?.hits ?? []).filter((h) => h.type === 'event') as Extract<
    SearchResponse['hits'][number],
    { type: 'event' }
  >[];

  const showingResults = q.trim().length > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary flex items-center gap-1"
        title="搜索 / 快捷操作 (⌘K)"
        aria-label="打开命令面板"
      >
        <span>搜索</span>
        <kbd className="ml-1 rounded border border-gray-300 bg-gray-50 px-1 text-xs text-gray-500">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16 sm:pt-24"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Command label="命令面板" shouldFilter={false}>
              <Command.Input
                ref={inputRef}
                value={q}
                onValueChange={setQ}
                placeholder="搜索联系人 / 待办 / 日程，或输入「新建…」"
                className="w-full border-b border-gray-200 px-4 py-3 text-sm outline-none"
              />

              <Command.List className="max-h-[60vh] overflow-y-auto py-1">
                {!showingResults && (
                  <>
                    <Command.Group heading="快捷操作" className="px-1 py-1">
                      {SHORTCUTS.map((s) => (
                        <Command.Item
                          key={s.id}
                          value={s.label}
                          onSelect={() => runShortcut(s.id)}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded mx-1 px-3 py-1.5 text-sm aria-selected:bg-blue-50"
                        >
                          <span className="font-medium">{s.label}</span>
                          <span className="text-xs text-gray-500">{s.hint}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
                      提示：输入文字搜索，<kbd className="rounded border bg-gray-50 px-1">⌘K</kbd> 再次唤起
                    </div>
                  </>
                )}

                {showingResults && loading && (
                  <div className="px-4 py-3 text-sm text-gray-500">搜索中…</div>
                )}

                {showingResults && !loading && data && data.hits.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-gray-500">无匹配</div>
                )}

                {showingResults && contacts.length > 0 && (
                  <Command.Group heading="联系人" className="px-1 py-1">
                    {contacts.slice(0, 6).map((c) => (
                      <Command.Item
                        key={c.id}
                        value={`contact-${c.id}-${c.nickname}`}
                        onSelect={() => go(`/contacts/${c.id}`)}
                        className="flex cursor-pointer items-center gap-2 rounded mx-1 px-3 py-1.5 text-sm aria-selected:bg-blue-50"
                      >
                        <span className="text-base">👤</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{c.nickname}</span>
                          {c.name && c.name !== c.nickname && (
                            <span className="ml-1 text-xs text-gray-500">({c.name})</span>
                          )}
                          {(c.company || c.city) && (
                            <span className="ml-2 text-xs text-gray-500">
                              {[c.company, c.city].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {showingResults && actions.length > 0 && (
                  <Command.Group heading="待办" className="px-1 py-1">
                    {actions.slice(0, 6).map((a) => (
                      <Command.Item
                        key={a.id}
                        value={`action-${a.id}-${a.title}`}
                        onSelect={() => go(`/actions/${a.id}`)}
                        className="flex cursor-pointer items-center gap-2 rounded mx-1 px-3 py-1.5 text-sm aria-selected:bg-blue-50"
                      >
                        <span className="text-base">☑</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{a.title}</span>
                          {a.contact && (
                            <span className="ml-1 text-xs text-gray-500">
                              → {a.contact.nickname ?? a.contact.name}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-gray-500">{a.status}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {showingResults && events.length > 0 && (
                  <Command.Group heading="日程" className="px-1 py-1">
                    {events.slice(0, 6).map((e) => (
                      <Command.Item
                        key={e.id}
                        value={`event-${e.id}-${e.title}`}
                        onSelect={() => go(`/events/${e.id}`)}
                        className="flex cursor-pointer items-center gap-2 rounded mx-1 px-3 py-1.5 text-sm aria-selected:bg-blue-50"
                      >
                        <span className="text-base">📅</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{e.title}</span>
                          {e.contact && (
                            <span className="ml-1 text-xs text-gray-500">
                              ({e.contact.nickname ?? e.contact.name})
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(e.startAt).toLocaleDateString('zh-CN')}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </div>
        </div>
      )}
    </>
  );
}
