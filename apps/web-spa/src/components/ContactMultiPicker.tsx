import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { Popover } from './Popover';
import { PickerEmptyState } from './PickerEmptyState';
import { QuickCreateContact } from './QuickCreateContact';
import type { Contact } from '../lib/adapter/types';

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function ContactMultiPicker({ selectedIds, onChange }: Props) {
  const adapter = useAdapter();
  const userId = useUserId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: () => adapter.contacts.list({ user_id: userId! }),
    enabled: !!userId,
  });
  const allContacts: Contact[] = contactsQuery.data?.items ?? [];

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedContacts = useMemo(
    () =>
      selectedIds
        .map((id) => allContacts.find((c) => c.id === id))
        .filter((c): c is Contact => !!c),
    [selectedIds, allContacts],
  );

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = allContacts.filter((c) => !selectedSet.has(c.id));
    if (!trimmed) return list.slice(0, 50);
    return list
      .filter(
        (c) =>
          (c.nickname ?? '').toLowerCase().includes(trimmed) ||
          (c.name ?? '').toLowerCase().includes(trimmed) ||
          (c.company ?? '').toLowerCase().includes(trimmed) ||
          (c.title ?? '').toLowerCase().includes(trimmed),
      )
      .slice(0, 50);
  }, [allContacts, selectedSet, trimmed]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };
  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));
  const clearAll = () => onChange([]);
  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const labelOf = (c: Contact) => c.nickname ?? c.name ?? '未命名';

  return (
    <div className="tag-picker" data-testid="contact-multi-picker">
      {selectedContacts.length > 0 ? (
        <div className="tag-picker__selected">
          <div className="tag-picker__bar">
            <span className="tag-picker__bar-label">已选 {selectedContacts.length}</span>
            <button
              type="button"
              className="tag-picker__bar-clear"
              onClick={clearAll}
              aria-label="清空所有选中联系人"
            >
              清空
            </button>
          </div>
          <div className="tag-picker__chips">
            {selectedContacts.map((c) => (
              <span key={c.id} className="tag-picker__chip" style={{ background: '#eef2ff', color: '#3730a3', borderColor: '#c7d2fe' }}>
                {labelOf(c)}
                <button
                  type="button"
                  aria-label={`移除 ${labelOf(c)}`}
                  onClick={() => remove(c.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="tag-picker__empty">尚未选择参与者</div>
      )}

      <div className="tag-picker__input-wrap">
        <button
          type="button"
          ref={inputRef as unknown as React.RefObject<HTMLButtonElement>}
          className="input-base"
          style={{ cursor: 'pointer', textAlign: 'left', color: 'var(--muted)' }}
          onClick={() => setOpen(true)}
        >
          + 添加参与者…
        </button>
      </div>

      <Popover
        anchorRef={inputRef}
        open={open}
        onClose={close}
        className="tag-picker__menu"
      >
        <div style={{ padding: '0 0 8px 0' }}>
          <input
            type="text"
            className="input-base"
            placeholder="搜索联系人…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {matches.length === 0 ? (
          <div className="tag-picker__hint" style={{ padding: 12 }}>
            {allContacts.length === 0 ? (
              <PickerEmptyState kind="contact" />
            ) : (
              '没有匹配的联系人'
            )}
          </div>
        ) : (
          <ul className="tag-picker__list">
            {matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="tag-picker__row"
                  onClick={() => toggle(c.id)}
                >
                  <span
                    className="tag-picker__checkbox"
                    style={{
                      borderColor: '#c7d2fe',
                      background: selectedSet.has(c.id) ? '#c7d2fe' : 'transparent',
                    }}
                  />
                  <span className="tag-picker__name">{labelOf(c)}</span>
                  {(c.company ?? c.title) && (
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                      {c.company ?? c.title}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
          <QuickCreateContact
            onCreated={(c) => {
              onChange(selectedIds.includes(c.id) ? selectedIds : [...selectedIds, c.id]);
            }}
          />
        </div>
      </Popover>
    </div>
  );
}