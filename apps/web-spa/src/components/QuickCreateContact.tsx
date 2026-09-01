import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type { Contact } from '../lib/adapter/types';

interface Props {
  onCreated: (contact: Contact) => void;
  initialNickname?: string;
  defaultOpen?: boolean;
}

export function QuickCreateContact({
  onCreated,
  initialNickname = '',
  defaultOpen = false,
}: Props) {
  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [nickname, setNickname] = useState(initialNickname);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isValid = nickname.trim().length > 0;

  const createMutation = useMutation({
    mutationFn: () =>
      adapter.contacts.create({
        user_id: userId!,
        nickname: nickname.trim(),
        name: name.trim() || null,
      }),
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      onCreated(contact);
      setOpen(false);
      setNickname('');
      setName('');
      setError(null);
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const handleSave = () => {
    if (!isValid) return;
    createMutation.mutate();
  };

  const handleCancel = () => {
    setOpen(false);
    setNickname('');
    setName('');
    setError(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        style={{ width: '100%', textAlign: 'left' }}
        onClick={() => setOpen(true)}
      >
        + 新建联系人
      </button>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <input
            className="input-base"
            style={{ width: '100%' }}
            placeholder="昵称 *"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={createMutation.isPending}
            autoFocus
          />
        </div>
        <div>
          <input
            className="input-base"
            style={{ width: '100%' }}
            placeholder="姓名（可选）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={createMutation.isPending}
          />
        </div>
      </div>
      {error && (
        <div
          style={{
            color: 'var(--danger, #dc2626)',
            fontSize: 'var(--text-sm)',
            marginTop: 6,
          }}
        >
          保存失败: {error}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 8,
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleCancel}
          disabled={createMutation.isPending}
        >
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={!isValid || createMutation.isPending}
        >
          {createMutation.isPending ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
