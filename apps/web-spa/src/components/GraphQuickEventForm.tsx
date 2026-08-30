import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { useGraphInvalidation } from './GraphQuickCreateModal';

export interface GraphQuickEventFormProps {
  centerContactId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function GraphQuickEventForm({
  centerContactId,
  onClose,
  onCreated,
  onCancel,
}: GraphQuickEventFormProps) {
  const adapter = useAdapter();
  const userId = useUserId();
  const invalidate = useGraphInvalidation();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('meeting');
  const [startAt, setStartAt] = useState(localDatetimeNow());
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('未登录');
      const event = await adapter.events.create({
        user_id: userId,
        title: title.trim(),
        type,
        start_at: toIsoLocal(startAt),
        contact_id: centerContactId,
        participant_contact_ids: centerContactId ? [centerContactId] : null,
      });
      return event;
    },
    onSuccess: (event) => {
      invalidate();
      onCreated(event.id);
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
          placeholder="例:与张总午餐"
          style={inputStyle}
        />
      </Field>
      <Field label="类型">
        <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
          <option value="meeting">会议</option>
          <option value="call">通话</option>
          <option value="meal">餐叙</option>
          <option value="event">活动</option>
        </select>
      </Field>
      <Field label="开始时间">
        <input
          type="datetime-local"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
          style={inputStyle}
        />
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

function localDatetimeNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function toIsoLocal(local: string): string {
  return new Date(local).toISOString();
}
