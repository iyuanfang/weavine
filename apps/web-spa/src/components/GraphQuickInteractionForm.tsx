import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { useGraphInvalidation, type GraphCenter } from './GraphQuickCreateModal';

export interface GraphQuickInteractionFormProps {
  center: GraphCenter;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function GraphQuickInteractionForm({
  center,
  onClose,
  onCreated,
  onCancel,
}: GraphQuickInteractionFormProps) {
  const adapter = useAdapter();
  const userId = useUserId();
  const invalidate = useGraphInvalidation();
  const [summary, setSummary] = useState('');
  const [channel, setChannel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('未登录');
      const interaction = await adapter.interactions.create({
        user_id: userId,
        summary: summary.trim() || '快速记录',
        channel: channel.trim() || null,
        occurred_at: new Date().toISOString(),
        contact_id: center.type === 'contact' ? center.id : null,
        action_id: center.type === 'action' ? center.id : null,
        event_id: center.type === 'event' ? center.id : null,
      });
      return interaction;
    },
    onSuccess: (interaction) => {
      invalidate();
      onCreated(interaction.id);
      onClose();
    },
    onError: (e: unknown) => setError(String(e)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        mutation.mutate();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Field label="内容">
        <input
          type="text"
          autoFocus
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="例:微信聊了几句 / 打了个电话"
          style={inputStyle}
        />
      </Field>
      <Field label="渠道（可选）">
        <input
          type="text"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="例:微信 / 电话 / 面谈"
          style={inputStyle}
        />
      </Field>
      {(center.type === 'contact' || center.type === 'action' || center.type === 'event') && (
        <div style={{ fontSize: 12, color: '#64748b' }}>
          将自动关联到当前{center.type === 'contact' ? '联系人' : center.type === 'action' ? '待办' : '日程'}
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
