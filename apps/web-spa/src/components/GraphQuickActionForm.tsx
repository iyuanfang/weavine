import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { useGraphInvalidation } from './GraphQuickCreateModal';

export interface GraphQuickActionFormProps {
  centerContactId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function GraphQuickActionForm({
  centerContactId,
  onClose,
  onCreated,
  onCancel,
}: GraphQuickActionFormProps) {
  const adapter = useAdapter();
  const userId = useUserId();
  const invalidate = useGraphInvalidation();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('未登录');
      const action = await adapter.actions.create({
        user_id: userId,
        title: title.trim(),
        priority,
        status: 'open',
        contact_id: centerContactId,
      });
      return action;
    },
    onSuccess: (action) => {
      invalidate();
      onCreated(action.id);
      onClose();
    },
    onError: (e: unknown) => setError(String(e)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) {
          setError('请填写标题');
          return;
        }
        setError(null);
        mutation.mutate();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Field label="标题">
        <input
          type="text"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例:回邮件 / 发介绍信"
          style={inputStyle}
        />
      </Field>
      <Field label="优先级">
        <select
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          style={inputStyle}
        >
          <option value={1}>高</option>
          <option value={2}>中</option>
          <option value={3}>低</option>
        </select>
      </Field>
      {centerContactId && (
        <div style={{ fontSize: 12, color: '#64748b' }}>
          将自动关联到当前联系人
        </div>
      )}
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="btn btn-ghost">返回</button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending}
          style={{ opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? '创建中…' : '创建并关联'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#64748b' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 14,
};
