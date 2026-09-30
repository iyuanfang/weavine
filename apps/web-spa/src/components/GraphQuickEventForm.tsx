import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { EVENT_PRESETS } from './categoryPresets';
import { ContactMultiPicker } from './ContactMultiPicker';
import { useGraphInvalidation, type GraphCenter } from './GraphQuickCreateModal';

export interface GraphQuickEventFormProps {
  center: GraphCenter;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** Override the default '创建并关联' submit text (standalone creation says just 创建日程). */
  submitLabel?: string;
}

export function GraphQuickEventForm({
  center,
  onClose,
  onCreated,
  onCancel,
  submitLabel,
}: GraphQuickEventFormProps) {
  const adapter = useAdapter();
  const userId = useUserId();
  const invalidate = useGraphInvalidation();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>(EVENT_PRESETS[0]?.value ?? '会议');
  const [startAt, setStartAt] = useState(localDatetimeNow());
  // Standalone creation (center is not a contact/project): the user picks
  // participants explicitly; the first one becomes the primary contact.
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('未登录');
      const event = await adapter.events.create({
        user_id: userId,
        title: title.trim(),
        type,
        start_at: toIsoLocal(startAt),
        contact_id: center.type === 'contact' ? center.id : participantIds[0] ?? null,
        project_id: center.type === 'project' ? center.id : null,
        participant_contact_ids: center.type === 'contact'
          ? [center.id]
          : participantIds.length > 0 ? participantIds : null,
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
          {EVENT_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.icon} {p.label}
            </option>
          ))}
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
      {center.type !== 'contact' && center.type !== 'project' && (
        <Field label="参与者（可多选，第一位为主联系人）">
          <ContactMultiPicker selectedIds={participantIds} onChange={setParticipantIds} />
        </Field>
      )}
      {(center.type === 'contact' || center.type === 'project') && (
        <div style={{ fontSize: 12, color: '#64748b' }}>
          将自动关联到当前{center.type === 'contact' ? '联系人' : '项目'}
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
          {mutation.isPending ? '创建中…' : (submitLabel ?? '创建并关联')}
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
