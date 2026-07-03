import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import { tagColor } from '../lib/tagColor';
import { Popover } from './Popover';
import type { Tag } from '../lib/adapter/types';

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function TagPicker({ selectedIds, onChange }: Props) {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => setOpen(false);

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  const allTags: Tag[] = tagsQuery.data ?? [];

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTags = useMemo(
    () =>
      selectedIds
        .map((id) => allTags.find((t) => t.id === id))
        .filter((t): t is Tag => !!t),
    [selectedIds, allTags],
  );

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = allTags.filter((t) => !selectedSet.has(t.id));
    if (!trimmed) return list;
    return list.filter((t) => t.name.toLowerCase().includes(trimmed));
  }, [allTags, selectedSet, trimmed]);

  const exactMatch =
    trimmed.length > 0 &&
    allTags.some((t) => t.name.toLowerCase() === trimmed);

  const createMut = useMutation({
    mutationFn: (name: string) =>
      adapter.tags.create({ owner_id: ownerId!, name }),
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: ['tags', ownerId] });
      onChange([...selectedIds, newTag.id]);
      setQuery('');
      inputRef.current?.focus();
    },
  });

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };

  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));

  const clearAll = () => onChange([]);

  return (
    <div className="tag-picker">
      {selectedTags.length > 0 ? (
        <div className="tag-picker__selected">
          <div className="tag-picker__bar">
            <span className="tag-picker__bar-label">已选 {selectedTags.length}</span>
            <button
              type="button"
              className="tag-picker__bar-clear"
              onClick={clearAll}
              aria-label="清空所有选中标签"
            >
              清空
            </button>
          </div>
          <div className="tag-picker__chips">
            {selectedTags.map((t) => {
              const c = tagColor(t);
              return (
                <span
                  key={t.id}
                  className="tag-picker__chip"
                  style={{
                    background: c,
                    color: '#fff',
                    borderColor: c,
                  }}
                >
                  {t.name}
                  <button
                    type="button"
                    aria-label={`移除标签 ${t.name}`}
                    onClick={() => remove(t.id)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="tag-picker__empty">尚未选择标签</div>
      )}

      <div className="tag-picker__input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="input-base"
          placeholder="搜索或输入新标签…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
      </div>

      <Popover
        anchorRef={inputRef}
        open={open}
        onClose={close}
        className="tag-picker__menu"
      >
        {trimmed.length > 0 && !exactMatch && (
          <button
            type="button"
            className="tag-picker__create"
            disabled={createMut.isPending}
            onClick={() => createMut.mutate(query.trim())}
          >
            <span className="tag-picker__create-plus">+</span>
            新建「{query.trim()}」
          </button>
        )}

        {matches.length === 0 && trimmed.length === 0 ? (
          <div className="tag-picker__hint">
            {allTags.length === 0
              ? '还没有标签。先在上面输入名字新建一个吧。'
              : '所有标签都已选中。'}
          </div>
        ) : matches.length === 0 && trimmed.length > 0 ? null : (
          <>
            {!trimmed && (
              <div className="tag-picker__hint tag-picker__hint--header">
                或选择已有
              </div>
            )}
            <ul className="tag-picker__list">
              {matches.map((t) => {
                const c = tagColor(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="tag-picker__row"
                      onClick={() => toggle(t.id)}
                    >
                      <span
                        className="tag-picker__checkbox"
                        style={{ borderColor: c }}
                      />
                      <span
                        className="tag-picker__dot"
                        style={{ background: c }}
                      />
                      <span className="tag-picker__name">{t.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Popover>

      {createMut.isError && (
        <div className="error-banner" style={{ marginTop: 8, fontSize: 12 }}>
          {String(createMut.error?.message ?? '新建标签失败')}
        </div>
      )}
    </div>
  );
}
