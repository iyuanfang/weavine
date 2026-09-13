import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { QuickCreateContact } from './QuickCreateContact';
import type { Contact } from '../lib/adapter/types';

/**
 * Modal for attaching contacts to something: search existing contacts,
 * multi-select, and quick-create new ones inline — the same interaction
 * as the event/project forms' contact picker, but as a standalone dialog
 * usable from detail pages.
 *
 * onConfirm receives the full set of picked ids (existing + just created);
 * excludeIds are filtered out of the list (e.g. already-added participants).
 */
export function ContactPickOrCreateModal({
  title = '添加联系人',
  confirmLabel = '添加',
  excludeIds = [],
  multiple = true,
  onConfirm,
  onClose,
}: {
  title?: string;
  confirmLabel?: string;
  excludeIds?: string[];
  /** false = single-pick: clicking a row confirms immediately. */
  multiple?: boolean;
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const adapter = useAdapter();
  const userId = useUserId();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: () => adapter.contacts.list({ user_id: userId! }),
    enabled: !!userId,
  });
  const allContacts: Contact[] = contactsQuery.data?.items ?? [];

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const candidates = useMemo(
    () => allContacts.filter((c) => !excludeSet.has(c.id)),
    [allContacts, excludeSet],
  );

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!trimmed) return candidates.slice(0, 50);
    return candidates
      .filter(
        (c) =>
          (c.nickname ?? '').toLowerCase().includes(trimmed) ||
          (c.name ?? '').toLowerCase().includes(trimmed) ||
          (c.company ?? '').toLowerCase().includes(trimmed) ||
          (c.title ?? '').toLowerCase().includes(trimmed),
      )
      .slice(0, 50);
  }, [candidates, trimmed]);

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const labelOf = (c: Contact) => c.nickname ?? c.name ?? '未命名';
  const pickedCount = picked.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="contact-pick-or-create"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          padding: 20,
          maxWidth: 440,
          width: '100%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button type="button" onClick={onClose} className="btn btn-ghost" style={{ padding: '2px 10px' }} aria-label="关闭">
            ✕
          </button>
        </div>

        <input
          type="text"
          className="input-base"
          placeholder="搜索联系人（昵称 / 公司 / 职位）…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 8 }}
        />

        <div style={{ flex: 1, minHeight: 120, overflowY: 'auto' }}>
          {contactsQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : matches.length === 0 ? (
            <div style={{ padding: 12, fontSize: 'var(--text-sm)', color: 'var(--muted)', textAlign: 'center' }}>
              {allContacts.length === 0
                ? '通讯录为空，在下方直接新建'
                : trimmed
                  ? '没有匹配的联系人'
                  : '都已添加过了'}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
              {matches.map((c) => {
                const active = picked.includes(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => (multiple ? toggle(c.id) : onConfirm([c.id]))}
                      data-testid={`pick-contact-${c.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '8px 10px',
                        border: `1px solid ${active ? '#c7d2fe' : 'transparent'}`,
                        background: active ? '#eef2ff' : 'transparent',
                        borderRadius: 6,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 'var(--text-base)',
                      }}
                      >
                      {multiple && (
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 4,
                            border: '1px solid #c7d2fe',
                            background: active ? '#c7d2fe' : 'transparent',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span style={{ fontWeight: 500 }}>{labelOf(c)}</span>
                      {(c.company ?? c.title) && (
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                          {[c.company, c.title].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 10 }}>
          <QuickCreateContact
            onCreated={(c) => {
              if (!excludeSet.has(c.id) && !picked.includes(c.id)) {
                setPicked((prev) => [...prev, c.id]);
              }
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          {multiple && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pickedCount === 0}
              data-testid="contact-pick-confirm"
              onClick={() => onConfirm(picked)}
            >
              {confirmLabel}
              {pickedCount > 0 ? `（${pickedCount}）` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
