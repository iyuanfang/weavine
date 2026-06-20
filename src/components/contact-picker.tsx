'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Avatar } from './avatar';

export type PickerContact = {
  id: string;
  nickname: string;
  name?: string | null;
  company?: string | null;
  city?: string | null;
  avatarUrl?: string | null;
};

function displayName(c: PickerContact): string {
  return c.nickname || c.name || '?';
}

export function ContactPicker({
  contacts,
  name,
  defaultValue = '',
  placeholder = '搜索：昵称 / 姓名 / 公司 / 城市',
  allowClear = true,
  onChangeCustom,
}: {
  contacts: PickerContact[];
  name: string;
  defaultValue?: string;
  placeholder?: string;
  allowClear?: boolean;
  onChangeCustom?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const selected = useMemo(
    () => contacts.find((c) => c.id === value) ?? null,
    [contacts, value],
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function commit(v: string) {
    setValue(v);
    onChangeCustom?.(v);
  }

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input-base flex w-full items-center justify-between text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={displayName(selected)} size={20} src={selected.avatarUrl} />
            <span className="truncate">
              {displayName(selected)}
              {selected.name && selected.name !== selected.nickname && (
                <span className="ml-1 text-xs text-gray-500">({selected.name})</span>
              )}
              {(selected.company || selected.city) && (
                <span className="ml-2 text-xs text-gray-500">
                  {[selected.company, selected.city].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          </span>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg">
          <Command label="联系人">
            <Command.Input
              autoFocus
              placeholder="输入昵称、姓名、公司或城市…"
              className="w-full rounded-t border-b border-gray-200 px-3 py-2 text-sm outline-none"
            />
            <Command.List className="max-h-64 overflow-y-auto py-1">
              <Command.Empty className="px-3 py-2 text-sm text-gray-500">无匹配</Command.Empty>
              {allowClear && (
                <Command.Item
                  value="__none__"
                  onSelect={() => {
                    commit('');
                    setOpen(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-500 aria-selected:bg-gray-100"
                >
                  无（不关联）
                </Command.Item>
              )}
              {contacts.map((c) => {
                const label = [c.nickname, c.name, c.company, c.city]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <Command.Item
                    key={c.id}
                    value={label + ' ' + c.id}
                    onSelect={() => {
                      commit(c.id);
                      setOpen(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm aria-selected:bg-blue-50"
                  >
                    <Avatar name={displayName(c)} size={24} src={c.avatarUrl} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{displayName(c)}</span>
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
                );
              })}
            </Command.List>
          </Command>
        </div>
      )}
    </div>
  );
}
